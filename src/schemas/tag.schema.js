const mongoose = require('mongoose')

const tagSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        color: {
            type: String,
            default: '#2db7f5',
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('Tag', tagSchema)
