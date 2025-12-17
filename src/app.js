const express = require('express')
const { port } = require('./config/index.js')
const loader = require('./loaders/index.js')

const app = express()

loader(app)

// Chỉ listen khi chạy local, không chạy trên Vercel (serverless)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, err => {
    if (err) {
      console.log(err)
      return process.exit(1)
    }
    console.log(`Server is running on ${port}`)
  })
}

module.exports = app