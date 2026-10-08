#!/usr/bin/env python3
"""Exercise the packaged API and both real ML workers in a temporary project."""
import argparse
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-dir", type=Path, default=ROOT / "src-tauri/resources")
    args = parser.parse_args()
    binary = args.runtime_dir.resolve() / "backend-runtime" / (
        "backend-runtime.exe" if os.name == "nt" else "backend-runtime")
    with tempfile.TemporaryDirectory(prefix="mimir packaged smoke ") as directory:
        work = Path(directory)
        env = os.environ.copy()
        for key, name in (("MIMIR_APP_DATA_DIR", "data"), ("MIMIR_CACHE_DIR", "cache"), ("MIMIR_TEMP_DIR", "tmp")):
            env[key] = str(work / name)
        env.update({"MIMIR_PARENT_PID": str(os.getpid()), "MIMIR_PERFORMANCE_PROFILE": "balanced"})
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            port = port_socket.getsockname()[1]
        base = f"http://127.0.0.1:{port}"

        def request(path, data=None, content_type="application/json"):
            if data is not None and not isinstance(data, bytes):
                data = json.dumps(data).encode()
            req = Request(base + path, data=data, headers={"Content-Type": content_type})
            with urlopen(req, timeout=15) as response:
                return json.load(response)

        with (work / "backend.log").open("w+b") as log:
            process = subprocess.Popen([str(binary), "--port", str(port)], cwd=work, env=env,
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                deadline = time.monotonic() + 60
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(f"API exited: {process.returncode}")
                    try:
                        request("/health")
                        break
                    except URLError:
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Packaged API did not become healthy")
                        time.sleep(0.2)
                project = request("/projects/", {"name": "Packaged runtime smoke"})["id"]
                pdf = BytesIO()
                canvas = Canvas(pdf, pagesize=(600, 800))
                for _ in range(2):
                    canvas.setFont("Times-Roman", 22)
                    for row in range(8):
                        canvas.drawString(50, 700 - row * 40, "Norske Eventyr og Fortaellinger.")
                    canvas.showPage()
                canvas.save()
                boundary = "mimir-smoke-boundary"
                body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.pdf"\r\n'
                        'Content-Type: application/pdf\r\n\r\n').encode() + pdf.getvalue() + f"\r\n--{boundary}--\r\n".encode()
                upload = request(f"/files/projects/{project}/upload-pdf", body, f"multipart/form-data; boundary={boundary}")
                job = request(f"/ocr/projects/{project}/jobs", {"upload_id": upload["upload_id"], "config": {"dpi": 150}})
                deadline = time.monotonic() + 600
                while job["status"] not in ("succeeded", "failed"):
                    if time.monotonic() >= deadline:
                        raise TimeoutError(f"Packaged OCR timed out: {job}")
                    time.sleep(0.5)
                    job = request(f'/ocr/jobs/{job["job_id"]}')
                assert job["status"] == "succeeded", job.get("error")
                pages = request(f"/projects/{project}/pages")["pages"]
                assert len(pages) == 2, pages
                assert [page["page_number"] for page in pages] == [0, 1]
                for page in pages:
                    assert page["lines"], "Segmentation produced no lines"
                    assert Path(page["img_path"]).is_file(), "Page artifact was not persisted"
                    assert any(line["ocr_text"] for line in page["lines"]), "OCR produced no text"
                    assert all(Path(line["img_path"]).is_file() for line in page["lines"])
                assert request(f'/ocr/jobs/{job["job_id"]}/transcript')["transcript"]
                print("Packaged API -> segmentation -> OCR -> persisted results: passed")
            except BaseException:
                log.flush()
                log.seek(0)
                print(log.read().decode("utf-8", errors="replace"))
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                # Workers also watch the API parent during native inference.
                time.sleep(2.5)


if __name__ == "__main__":
    main()
