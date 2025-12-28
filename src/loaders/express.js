const express = require('express')
const cors = require('cors')
const compression = require('compression')
const helmet = require('helmet')
const { prefix } = require('./../config/index.js')
const routes = require('./../api/routes/index.js')

module.exports = (app) => {
  process.on('uncaughtException', async (error) => {
    console.log(error)
  })

  process.on('unhandledRejection', async (ex) => {
    console.log(ex)
  })

  app.enable('trust proxy')
  
  // Configure CORS for both local and production
  const allowedOrigins = [
    'http://localhost:3001',
    'http://localhost:5173',
    process.env.FRONTEND_URL || 'https://your-frontend.vercel.app'
  ].filter(Boolean)
  
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true
  }))
  
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ limit: '10mb', extended: true }))
  app.use(helmet())
  app.use(compression())
  app.use(express.static('public'))
  app.use('/uploads', express.static('uploads'))
  app.disable('x-powered-by')

  app.use(prefix, routes);

  app.get('/', (_req, res) => {
    return res.status(200).json({
      message: 'Server is running successfully',
      status: 'OK'
    });
  });

  // 404 handler
  app.use((_req, _res, next) => {
    const error = new Error('Endpoint not found');
    error.status = 404;
    next(error);
  });

  // Error handler
  app.use((error, req, res, _next) => {
    console.error('Error:', error.message);
    const statusCode = error.status || 500;
    
    res.status(statusCode).json({
      message: error.message || 'Internal server error',
      status: 'error',
      statusCode
    });
  });
}