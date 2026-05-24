export function requireToken(token) {
  if (!token) {
    // No token configured — pass through but log a warning per request in dev
    return (_req, _res, next) => next();
  }
  return (req, res, next) => {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}
