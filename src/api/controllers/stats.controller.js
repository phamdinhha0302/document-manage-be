const { Document, Category, Tag } = require('../../schemas')
const mongoose = require('mongoose')

class StatsController {
    // Get dashboard statistics for authenticated user
    static async getStats(req, res) {
        try {
            const userId = req.user.userId

            // 1. Total documents count (user's documents only)
            const totalDocuments = await Document.countDocuments({
                uploadedBy: new mongoose.Types.ObjectId(userId)
            })

            // 2. Total views (sum of views for all user's documents)
            const viewsResult = await Document.aggregate([
                {
                    $match: {
                        uploadedBy: new mongoose.Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalViews: { $sum: '$views' }
                    }
                }
            ])
            const totalViews = viewsResult[0]?.totalViews || 0

            // 3. Total downloads (sum of downloads for all user's documents)
            const downloadsResult = await Document.aggregate([
                {
                    $match: {
                        uploadedBy: new mongoose.Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalDownloads: { $sum: '$downloads' }
                    }
                }
            ])
            const totalDownloads = downloadsResult[0]?.totalDownloads || 0

            // 4. Total categories (count of unique categories used by user's documents)
            const categoriesResult = await Document.aggregate([
                {
                    $match: {
                        uploadedBy: new mongoose.Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: '$category'
                    }
                },
                {
                    $count: 'total'
                }
            ])
            const totalCategories = categoriesResult[0]?.total || 0

            // 5. Documents by category (distribution)
            const documentsByCategory = await Document.aggregate([
                {
                    $match: {
                        uploadedBy: new mongoose.Types.ObjectId(userId)
                    }
                },
                {
                    $group: {
                        _id: '$category',
                        count: { $sum: 1 }
                    }
                },
                {
                    $lookup: {
                        from: 'categories',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'categoryData'
                    }
                },
                {
                    $unwind: {
                        path: '$categoryData',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $project: {
                        _id: 0,
                        categoryId: '$_id',
                        categoryName: { $ifNull: ['$categoryData.name', 'Uncategorized'] },
                        count: 1
                    }
                },
                {
                    $sort: { count: -1 }
                }
            ])

            // 6. Recent documents (last 5 documents)
            const recentDocuments = await Document.find({
                uploadedBy: new mongoose.Types.ObjectId(userId)
            })
                .populate('category', 'name')
                .select('title category views downloads createdAt fileType')
                .sort({ createdAt: -1 })
                .limit(5)

            res.status(200).json({
                success: true,
                data: {
                    totalDocuments,
                    totalViews,
                    totalDownloads,
                    totalCategories,
                    documentsByCategory,
                    recentDocuments
                }
            })
        } catch (error) {
            console.error(error)
            res.status(500).json({
                success: false,
                message: error.message
            })
        }
    }
}

module.exports = StatsController
