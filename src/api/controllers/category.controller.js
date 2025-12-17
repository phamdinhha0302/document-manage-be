const { Category } = require('../../schemas')

class CategoryController {
    // Get all categories
    static async getCategories(req, res) {
        try {
            const categories = await Category.find().sort({ sortOrder: 1, createdAt: -1 })

            res.status(200).json({
                success: true,
                data: categories,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Get single category
    static async getCategory(req, res) {
        try {
            const { id } = req.params

            const category = await Category.findById(id)

            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Category not found',
                })
            }

            res.status(200).json({
                success: true,
                data: category,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Create category (admin only)
    static async createCategory(req, res) {
        try {
            const { name, description, icon, color, sortOrder } = req.body

            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Name is required',
                })
            }

            const category = new Category({
                name,
                description,
                icon,
                color,
                sortOrder,
            })

            await category.save()

            res.status(201).json({
                success: true,
                message: 'Category created successfully',
                data: category,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Update category (admin only)
    static async updateCategory(req, res) {
        try {
            const { id } = req.params
            const { name, description, icon, color, sortOrder } = req.body

            const category = await Category.findById(id)

            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Category not found',
                })
            }

            if (name) category.name = name
            if (description) category.description = description
            if (icon) category.icon = icon
            if (color) category.color = color
            if (sortOrder !== undefined) category.sortOrder = sortOrder

            await category.save()

            res.status(200).json({
                success: true,
                message: 'Category updated successfully',
                data: category,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Delete category (admin only)
    static async deleteCategory(req, res) {
        try {
            const { id } = req.params

            const category = await Category.findById(id)

            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Category not found',
                })
            }

            await Category.findByIdAndDelete(id)

            res.status(200).json({
                success: true,
                message: 'Category deleted successfully',
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }
}

module.exports = CategoryController
