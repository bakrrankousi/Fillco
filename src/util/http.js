// Small helpers for consistent JSON error responses across routes.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function badRequest(message) {
  return new ApiError(400, message);
}
function unauthorized(message = "Not signed in.") {
  return new ApiError(401, message);
}
function forbidden(message = "Not allowed.") {
  return new ApiError(403, message);
}
function notFound(message = "Not found.") {
  return new ApiError(404, message);
}

// Wraps an async route handler so a thrown/rejected error reaches Express's
// error middleware (below) as clean JSON instead of an unhandled rejection.
function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function errorMiddleware(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error." });
}

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, wrap, errorMiddleware };
