const mongoose = require('mongoose')

const documentSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        // De-accented title for Vietnamese search
        titleSearch: {
            type: String,
            default: '',
        },
        description: {
            type: String,
            default: '',
        },
        // De-accented description for Vietnamese search
        descriptionSearch: {
            type: String,
            default: '',
        },
        fileName: {
            type: String,
            required: true,
        },
        // De-accented fileName for Vietnamese search
        fileNameSearch: {
            type: String,
            default: '',
        },
        fileUrl: {
            type: String,
            required: true,
        },
        fileSize: {
            type: Number,
            default: 0,
        },
        fileType: {
            type: String,
            default: 'pdf',
        },
        folder: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Folder',
            default: null,
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
        },
        tags: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Tag',
            },
        ],
        uploadedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        views: {
            type: Number,
            default: 0,
        },
        downloads: {
            type: Number,
            default: 0,
        },
        isPublic: {
            type: Boolean,
            default: false,
        },
        notes: {
            type: String,
            default: '',
        },
        summary: {
            type: String,
            default: '',
        },
        metadata: {
            pages: { type: Number, default: null },
            author: { type: String, default: null },
            keywords: [String],
        },
        ocrContent: {
            type: String,
            default: '',
        },
        // De-accented OCR content for Vietnamese search
        ocrContentSearch: {
            type: String,
            default: '',
        },
        ocrLanguage: {
            type: String,
            default: 'eng',
        },
        ocrConfidence: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        // NEW: OCR Fields with bounding boxes
        ocrFields: [
            {
                text: String,
                confidence: Number,
                type: { type: String, default: null },
                bbox: {
                    x1: Number,
                    y1: Number,
                    x2: Number,
                    y2: Number,
                },
            }
        ],
        // NEW: Document type detected by OCR (id_card, passport, etc)
        documentType: {
            type: String,
            default: null,
            enum: [null, 'id_card', 'passport', 'driver_license', 'other'],
        },
    },
    { timestamps: true }
)

// Index for search (original text)
documentSchema.index({ title: 'text', description: 'text', 'metadata.keywords': 'text' })

// Index for Vietnamese accent-insensitive search
documentSchema.index({ titleSearch: 1 })
documentSchema.index({ descriptionSearch: 1 })
documentSchema.index({ fileNameSearch: 1 })
documentSchema.index({ ocrContentSearch: 1 })

module.exports = mongoose.model('Document', documentSchema)
