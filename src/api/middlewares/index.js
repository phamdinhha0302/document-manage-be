const { authMiddleware, optionalAuthMiddleware, adminMiddleware } = require('./auth.middleware')

module.exports = {
    authMiddleware,
    optionalAuthMiddleware,
    adminMiddleware,
}
