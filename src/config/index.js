const { config } = require('dotenv')
config()

//NOTE: If you are running the project in an instance, you should store these secret keys in its configuration settings.
// This type of storing secret information is only experimental and for the purpose of local running.

const { DB_URI, PORT } = process.env

const port = PORT || 3000
const dbUri = DB_URI
const prefix = '/api'
const specs = '/docs'

module.exports = {
  port,
  dbUri,
  prefix,
  specs
}