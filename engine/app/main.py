"""SentinelDesk triage engine (FastAPI). Private: only the Go gateway calls it.

Run from the repo root (single worker, because the burst detector keeps state in memory):

    uvicorn engine.app.main:app --port 8000 --workers 1
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from engine.app import pipeline
from engine.app.schemas import CONTRACT_VERSION, EngineHealth, EngineTriageRequest, EngineTriageResponse, ErrorResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(
    title="SentinelDesk engine",
    version=CONTRACT_VERSION,
    description="Private triage engine. Contract: contracts/README.md",
)


def _error(status: int, code: str, message: str, request_id: str | None = None) -> JSONResponse:
    body = ErrorResponse.model_validate({"error": {"code": code, "message": message, "request_id": request_id}})
    return JSONResponse(status_code=status, content=body.model_dump())


@app.exception_handler(RequestValidationError)
async def _on_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    first = errors[0] if errors else {}
    if first.get("type") == "json_invalid":
        return _error(400, "INVALID_JSON", "The request body is not valid JSON.")
    loc = tuple(first.get("loc", ()))
    if loc and loc[0] == "body":  # FastAPI prefixes the request part; keep the field path
        loc = loc[1:]
    where = ".".join(str(p) for p in loc)
    msg = first.get("msg", "Invalid request.")
    return _error(422, "VALIDATION_ERROR", f"{where}: {msg}" if where else msg)


@app.exception_handler(pipeline.ContractViolation)
async def _on_contract_violation(_: Request, exc: pipeline.ContractViolation) -> JSONResponse:
    return _error(500, "INTERNAL", str(exc))


@app.exception_handler(Exception)
async def _on_unexpected(_: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("sentineldesk.engine").exception("unhandled error")
    return _error(500, "INTERNAL", "The engine hit an unexpected error. Check the engine logs.")


@app.get("/healthz", response_model=EngineHealth)
def healthz() -> EngineHealth:
    stages = pipeline.stage_status()
    return EngineHealth(
        status="degraded" if "stub" in stages.values() else "ok",
        contract_version=CONTRACT_VERSION,
        stages=stages,
        # Filled in by H-06 (artifacts), H-07 (llm) and H-14 (vector_db, readiness).
        components={"vector_db": "unknown", "llm": "unknown", "artifacts": "unknown"},
    )


@app.post(
    "/v1/triage",
    response_model=EngineTriageResponse,
    responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
)
def triage(req: EngineTriageRequest) -> EngineTriageResponse:
    return pipeline.run_triage(req)
