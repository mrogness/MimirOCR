"""Bounded page dispatch to isolated workers, with cleanup before returning."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Empty, Queue
from threading import Lock

from backend.workers.client import WorkerClient


def run_stage(role, pages, config, worker_count, on_page_done):
    if not pages:
        return []
    if role == "recognizer" and not any(page.lines for page in pages):
        for index in range(1, len(pages) + 1):
            on_page_done(index, len(pages))
        return pages
    pending = Queue()
    for page in pages:
        pending.put(page)
    clients = []
    completed = 0
    progress_lock = Lock()
    executor = ThreadPoolExecutor(max_workers=min(worker_count, len(pages)))

    def run(client):
        nonlocal completed
        client.initialize(config)
        output = []
        while True:
            try:
                page = pending.get_nowait()
            except Empty:
                return output
            output.append(client.process_page(page))
            with progress_lock:
                completed += 1
                on_page_done(completed, len(pages))

    try:
        for _ in range(min(worker_count, len(pages))):
            clients.append(WorkerClient(role))
        futures = [executor.submit(run, client) for client in clients]
        output = []
        for future in as_completed(futures):
            output.extend(future.result())
        return sorted(output, key=lambda page: page.page_number)
    finally:
        # Stop all processes before waiting for dispatch threads on a failed page.
        # This unblocks sibling IPC calls and prevents late writes into deleted temp files.
        for client in clients:
            client.close()
        executor.shutdown(wait=True, cancel_futures=True)
