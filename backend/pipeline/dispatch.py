"""Bounded page dispatch to isolated workers, restoring order and closing clients."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections.abc import Callable
from queue import Empty, Queue
from threading import Lock

from backend.domain.page import Page
from backend.domain.project_config import ProjectConfig
from backend.workers.client import WorkerClient


def run_stage(
    role: str,
    pages: list[Page],
    config: ProjectConfig,
    worker_count: int,
    on_page_done: Callable[[int, int], None],
) -> list[Page]:
    """Process a page batch, reusing each worker's model for its assigned pages.

    Args:
        role: Segmenter or recognizer runtime name.
        pages: Domain pages ready for this stage.
        config: Run configuration sent to each worker during initialization.
        worker_count: Maximum clients to launch, capped at the number of pages.
        on_page_done: Synchronous callback receiving completed and total counts.

    Returns:
        Processed pages sorted by source page number.

    All clients are closed even when a page fails. An empty recognizer batch
    reports completion without starting a model process.
    """
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
        """Initialize one model-owning client and drain queued pages until none remain.

        Collect that client's results and serialize completed-page progress callbacks with
        the shared lock.
        """
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
