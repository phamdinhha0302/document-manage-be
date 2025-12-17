const mongooseLoader = require('./mongoose.js')
const expressLoader = require('./express.js')

module.exports = async (app) => {
  await mongooseLoader()
  expressLoader(app)
}