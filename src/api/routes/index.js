const express = require('express')
const router = express.Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { authMiddleware, optionalAuthMiddleware, adminMiddleware } = require('../middlewares')
const AuthController = require('../controllers/auth.controller')
const DocumentController = require('../controllers/document.controller')
const CategoryController = require('../controllers/category.controller')
const TagController = require('../controllers/tag.controller')
const FolderController = require('../controllers/folder.controller')
const StatsController = require('../controllers/stats.controller')

// Ensure uploads directory exists (skip on Vercel/Serverless)
const uploadsDir = 'uploads/documents'
if (!fs.existsSync(uploadsDir) && process.env.NODE_ENV !== 'production') {
    try {
        fs.mkdirSync(uploadsDir, { recursive: true })
    } catch (err) {
        console.log('Warning: Could not create uploads directory', err.message)
    }
}

// Configure multer for file upload (DISK STORAGE)
const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/documents')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, uniqueSuffix + path.extname(file.originalname))
    },
})

// Configure multer for memory storage (for AI processing)
const memoryStorage = multer.memoryStorage()

// Common multer config
const multerConfig = {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/bmp',
            'text/plain',
            'text/markdown'
        ]
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true)
        } else {
            cb(new Error(`Invalid file type: ${file.mimetype}`))
        }
    },
}

// Create two upload middleware instances
const uploadDisk = multer({ storage: diskStorage, ...multerConfig })
const uploadMemory = multer({ storage: memoryStorage, ...multerConfig })

// ============ AUTH ROUTES ============
router.post('/auth/register', AuthController.register)
router.post('/auth/login', AuthController.login)
router.get('/auth/profile', authMiddleware, AuthController.getProfile)

// ============ STATS ROUTES ============
router.get('/stats', authMiddleware, StatsController.getStats)

// ============ DOCUMENT ROUTES ============
router.get('/documents', optionalAuthMiddleware, DocumentController.getDocuments)
router.get('/documents/:id', optionalAuthMiddleware, DocumentController.getDocument)

// Use DISK storage for document uploads (saved to filesystem)
router.post('/documents', authMiddleware, uploadDisk.single('file'), DocumentController.uploadDocument)

router.put('/documents/:id', authMiddleware, DocumentController.updateDocument)
router.delete('/documents/:id', authMiddleware, DocumentController.deleteDocument)
router.get('/search/documents', optionalAuthMiddleware, DocumentController.searchDocuments)
router.get('/documents/:id/download', optionalAuthMiddleware, DocumentController.downloadDocument)
router.post('/documents/:id/summarize', authMiddleware, DocumentController.summarizeDocument)

// Use DISK storage for OCR uploads
router.post('/documents/ocr/upload', authMiddleware, uploadDisk.single('file'), DocumentController.uploadAndProcessOCR)
router.post('/documents/:id/ocr', authMiddleware, DocumentController.processOCR)

// ============ CATEGORY ROUTES ============
router.get('/categories', CategoryController.getCategories)
router.get('/categories/:id', CategoryController.getCategory)
router.post('/categories', authMiddleware, CategoryController.createCategory)
router.put('/categories/:id', authMiddleware, adminMiddleware, CategoryController.updateCategory)
router.delete('/categories/:id', authMiddleware, adminMiddleware, CategoryController.deleteCategory)

// ============ TAG ROUTES ============
router.get('/tags', TagController.getTags)
router.post('/tags', authMiddleware, TagController.createTag)
router.delete('/tags/:id', authMiddleware, adminMiddleware, TagController.deleteTag)

// ============ FOLDER ROUTES ============
router.get('/folders', authMiddleware, FolderController.getRootFolders)
router.get('/folders/:folderId/hierarchy', authMiddleware, FolderController.getFolderHierarchy)
router.get('/folders/:folderId/breadcrumb', authMiddleware, FolderController.getFolderBreadcrumb)
router.post('/folders', authMiddleware, FolderController.createFolder)
router.put('/folders/:folderId', authMiddleware, FolderController.updateFolder)
router.delete('/folders/:folderId', authMiddleware, FolderController.deleteFolder)
router.put('/folders/:folderId/share', authMiddleware, FolderController.shareFolder)

// ============ AI ROUTES ============
// Use MEMORY storage for AI classification (need buffer for Gemini)
router.post('/ai/classify-filename', authMiddleware, uploadMemory.single('file'), DocumentController.classifyFileName)
router.post('/ai/classify-category', authMiddleware, uploadMemory.single('file'), DocumentController.classifyCategory)

// Health check route
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' })
})

module.exports = router