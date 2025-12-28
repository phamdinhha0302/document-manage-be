const mongoose = require('mongoose')

const folderSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
        },
        parent: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Folder',
            default: null, // null means it's a root folder
        },
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        isPublic: {
            type: Boolean,
            default: false,
        },
        isRoot: {
            type: Boolean,
            default: false, // true for the main "My Drive" folder
        },
    },
    { timestamps: true }
)

// Index for searching folders
folderSchema.index({ name: 'text', description: 'text' })
folderSchema.index({ owner: 1 })
folderSchema.index({ parent: 1 })

module.exports = mongoose.model('Folder', folderSchema)
