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

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/documents')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, uniqueSuffix + path.extname(file.originalname))
    },
})

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'text/plain']
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true)
        } else {
            cb(new Error('Invalid file type'))
        }
    },
})

// ============ AUTH ROUTES ============
router.post('/auth/register', AuthController.register)
router.post('/auth/login', AuthController.login)
router.get('/auth/profile', authMiddleware, AuthController.getProfile)

// ============ STATS ROUTES ============
// Get dashboard statistics for authenticated user
router.get('/stats', authMiddleware, StatsController.getStats)

// ============ DOCUMENT ROUTES ============
// Get all documents (public + user's private)
router.get('/documents', optionalAuthMiddleware, DocumentController.getDocuments)

// Get single document
router.get('/documents/:id', optionalAuthMiddleware, DocumentController.getDocument)

// Upload document (requires auth)
router.post('/documents', authMiddleware, upload.single('file'), DocumentController.uploadDocument)

// Update document (requires auth)
router.put('/documents/:id', authMiddleware, DocumentController.updateDocument)

// Delete document (requires auth)
router.delete('/documents/:id', authMiddleware, DocumentController.deleteDocument)

// Search documents
router.get('/search/documents', optionalAuthMiddleware, DocumentController.searchDocuments)

// Download document
router.get('/documents/:id/download', optionalAuthMiddleware, DocumentController.downloadDocument)

// Summarize document using Gemini
router.post('/documents/:id/summarize', authMiddleware, DocumentController.summarizeDocument)

// ============ CATEGORY ROUTES ============
// Get all categories
router.get('/categories', CategoryController.getCategories)

// Get single category
router.get('/categories/:id', CategoryController.getCategory)

// Create category (requires auth)
router.post('/categories', authMiddleware, CategoryController.createCategory)

// Update category (admin only)
router.put('/categories/:id', authMiddleware, adminMiddleware, CategoryController.updateCategory)

// Delete category (admin only)
router.delete('/categories/:id', authMiddleware, adminMiddleware, CategoryController.deleteCategory)

// ============ TAG ROUTES ============
// Get all tags
router.get('/tags', TagController.getTags)

// Create tag
router.post('/tags', authMiddleware, TagController.createTag)

// Delete tag (admin only)
router.delete('/tags/:id', authMiddleware, adminMiddleware, TagController.deleteTag)

// ============ FOLDER ROUTES ============
// Get root folders for authenticated user
router.get('/folders', authMiddleware, FolderController.getRootFolders)

// Get folder hierarchy (contents of a folder)
router.get('/folders/:folderId/hierarchy', authMiddleware, FolderController.getFolderHierarchy)

// Get breadcrumb path for a folder
router.get('/folders/:folderId/breadcrumb', authMiddleware, FolderController.getFolderBreadcrumb)

// Create new folder
router.post('/folders', authMiddleware, FolderController.createFolder)

// Update folder
router.put('/folders/:folderId', authMiddleware, FolderController.updateFolder)

// Delete folder (with cascading)
router.delete('/folders/:folderId', authMiddleware, FolderController.deleteFolder)

// Share folder
router.put('/folders/:folderId/share', authMiddleware, FolderController.shareFolder)

// Health check route
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' })
})

module.exports = router