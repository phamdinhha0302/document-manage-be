const multer = require('multer')
const path = require('path')
const fs = require('fs')

const __dirname = path.dirname(__filename) || process.cwd()

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads')
const createUploadDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

createUploadDir(uploadsDir)

// Basic storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    createUploadDir(uploadsDir)
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    const name = file.fieldname + '-' + uniqueSuffix + ext
    cb(null, name)
  }
})

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|svg/
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
  const mimetype = allowedTypes.test(file.mimetype)

  if (mimetype && extname) {
    return cb(null, true)
  } else {
    cb(new Error('Only image files are allowed!'))
  }
}

// Basic upload configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
})

module.exports = { upload }
