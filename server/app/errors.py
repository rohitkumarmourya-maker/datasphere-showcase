from fastapi import Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details
        super().__init__(message)


def error_response(request, status, code, message, details=None):
    request_id = request.scope["state"]["request_id"]
    return JSONResponse(
        {"error": {"code": code, "message": message, "request_id": request_id, "details": details}},
        status_code=status, headers={"X-Request-ID": request_id},
    )


async def api_error_handler(request: Request, exc: APIError):
    return error_response(request, exc.status, exc.code, exc.message, exc.details)


async def validation_error_handler(request: Request, exc: RequestValidationError):
    fields = [{"field": ".".join(map(str, e["loc"])), "message": e["msg"], "type": e["type"]}
              for e in exc.errors()]
    return error_response(request, 422, "VALIDATION_ERROR", "Request validation failed", {"fields": fields})


async def http_error_handler(request: Request, exc: HTTPException):
    codes = {400: "BAD_REQUEST", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 429: "BACKPRESSURE"}
    return error_response(request, exc.status_code, codes.get(exc.status_code, "HTTP_ERROR"), str(exc.detail))


async def unexpected_error_handler(request: Request, exc: Exception):
    return error_response(request, 500, "INTERNAL_ERROR", "An internal server error occurred")
