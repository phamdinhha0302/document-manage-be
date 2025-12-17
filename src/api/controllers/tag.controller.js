const { Tag } = require('../../schemas')

class TagController {
    // Get all tags
    static async getTags(req, res) {
        try {
            const tags = await Tag.find().sort({ createdAt: -1 })

            res.status(200).json({
                success: true,
                data: tags,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Create tag
    static async createTag(req, res) {
        try {
            const { name, color } = req.body

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Name is required',
                })
            }

            // Check if tag exists
            const existingTag = await Tag.findOne({ name: name.toLowerCase() })
            if (existingTag) {
                return res.status(400).json({
                    success: false,
                    message: 'Tag already exists',
                })
            }

            const tag = new Tag({
                name,
                color,
            })

            await tag.save()

            res.status(201).json({
                success: true,
                message: 'Tag created successfully',
                data: tag,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Delete tag (admin only)
    static async deleteTag(req, res) {
        try {
            const { id } = req.params

            const tag = await Tag.findById(id)

            if (!tag) {
                return res.status(404).json({
                    success: false,
                    message: 'Tag not found',
                })
            }

            await Tag.findByIdAndDelete(id)

            res.status(200).json({
                success: true,
                message: 'Tag deleted successfully',
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }
}

module.exports = TagController
