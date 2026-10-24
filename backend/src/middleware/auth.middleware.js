const authMiddleware = (req, res, next) => {
  const configuredKey = process.env.VURIX_API_KEY;

  // If no API key is configured in env, allow open access
  if (!configuredKey) {
    return next();
  }

  const clientKey = req.headers['x-vurix-api-key'] || req.query.api_key;
  if (!clientKey || clientKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing Vurix API Key.'
    });
  }

  next();
};

module.exports = authMiddleware;
