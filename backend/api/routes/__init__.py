"""Individual routes; application-wide composition lives in backend.api.router.

Keep this initializer lightweight so importing one route does not load unrelated
PDF or machine-learning dependencies.
"""
