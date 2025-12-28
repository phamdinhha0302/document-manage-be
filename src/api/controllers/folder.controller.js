const { Folder, Document } = require('../../schemas')

class FolderController {
    // Get all folders for a user (root level) - returns root folder (My Drive) first
    static async getRootFolders(req, res) {
        try {
            const userId = req.user.userId

            // Get root folder (My Drive)
            const rootFolder = await Folder.findOne({
                owner: userId,
                isRoot: true,
            })

            // Get other root folders (subfolders of My Drive)
            const folders = await Folder.find({
                owner: userId,
                parent: rootFolder ? rootFolder._id : null,
                isRoot: false,
            }).sort({ createdAt: -1 })

            res.status(200).json({
                success: true,
                data: {
                    rootFolder: rootFolder || null,
                    folders: folders,
                },
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Get folder hierarchy (folder with nested children and documents)
    static async getFolderHierarchy(req, res) {
        try {
            const { folderId } = req.params
            const userId = req.user.userId

            const folder = await Folder.findById(folderId)

            if (!folder) {
                return res.status(404).json({
                    success: false,
                    message: 'Folder not found',
                })
            }

            // Check permission
            if (folder.owner.toString() !== userId && !folder.isPublic) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied',
                })
            }

            // Get subfolders
            const subfolders = await Folder.find({
                parent: folderId,
            }).sort({ createdAt: -1 })

            // Get documents in this folder
            const documents = await Document.find({
                folder: folderId,
            })
                .populate('category')
                .populate('tags')
                .populate('uploadedBy', 'fullName email')
                .sort({ createdAt: -1 })

            res.status(200).json({
                success: true,
                data: {
                    folder,
                    subfolders,
                    documents,
                },
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Get folder breadcrumb path (from root to current folder)
    static async getFolderBreadcrumb(req, res) {
        try {
            const { folderId } = req.params

            const breadcrumb = []
            let currentFolder = await Folder.findById(folderId)

            while (currentFolder) {
                breadcrumb.unshift({
                    _id: currentFolder._id,
                    name: currentFolder.name,
                })
                if (currentFolder.parent) {
                    currentFolder = await Folder.findById(currentFolder.parent)
                } else {
                    currentFolder = null
                }
            }

            res.status(200).json({
                success: true,
                data: breadcrumb,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Create a new folder
    static async createFolder(req, res) {
        try {
            const { name, description, parent } = req.body
            const userId = req.user.userId

            // If no parent specified, use the user's root folder (My Drive)
            let parentId = parent
            if (!parent) {
                const rootFolder = await Folder.findOne({
                    owner: userId,
                    isRoot: true,
                })
                parentId = rootFolder ? rootFolder._id : null
            }

            // Validate parent folder if provided
            if (parentId) {
                const parentFolder = await Folder.findById(parentId)
                if (!parentFolder) {
                    return res.status(404).json({
                        success: false,
                        message: 'Parent folder not found',
                    })
                }
                // Check permission
                if (parentFolder.owner.toString() !== userId) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied to parent folder',
                    })
                }
            }

            const folder = new Folder({
                name,
                description: description || '',
                parent: parentId,
                owner: userId,
                isRoot: false,
            })

            await folder.save()

            res.status(201).json({
                success: true,
                data: folder,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Update folder
    static async updateFolder(req, res) {
        try {
            const { folderId } = req.params
            const { name, description, parent } = req.body
            const userId = req.user.userId

            const folder = await Folder.findById(folderId)

            if (!folder) {
                return res.status(404).json({
                    success: false,
                    message: 'Folder not found',
                })
            }

            // Check permission
            if (folder.owner.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied',
                })
            }

            // Validate parent folder if changing
            if (parent && parent !== folder.parent?.toString()) {
                const parentFolder = await Folder.findById(parent)
                if (!parentFolder) {
                    return res.status(404).json({
                        success: false,
                        message: 'Parent folder not found',
                    })
                }
                // Check permission
                if (parentFolder.owner.toString() !== userId) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied to parent folder',
                    })
                }
                // Prevent circular reference
                let checkFolder = parentFolder
                while (checkFolder.parent) {
                    if (checkFolder.parent.toString() === folderId) {
                        return res.status(400).json({
                            success: false,
                            message: 'Cannot move folder to its own subfolder',
                        })
                    }
                    checkFolder = await Folder.findById(checkFolder.parent)
                }
                folder.parent = parent
            }

            if (name) folder.name = name
            if (description !== undefined) folder.description = description

            await folder.save()

            res.status(200).json({
                success: true,
                data: folder,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Delete folder (with cascading) - cannot delete root folder (My Drive)
    static async deleteFolder(req, res) {
        try {
            const { folderId } = req.params
            const userId = req.user.userId

            const folder = await Folder.findById(folderId)

            if (!folder) {
                return res.status(404).json({
                    success: false,
                    message: 'Folder not found',
                })
            }

            // Check permission
            if (folder.owner.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied',
                })
            }

            // Prevent deletion of root folder (My Drive)
            if (folder.isRoot) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete root folder (My Drive)',
                })
            }

            // Get all subfolders recursively
            const getAllSubfolders = async (parentId) => {
                const subfolders = await Folder.find({ parent: parentId })
                const allFolders = [...subfolders]
                for (const subfolder of subfolders) {
                    const nested = await getAllSubfolders(subfolder._id)
                    allFolders.push(...nested)
                }
                return allFolders
            }

            const subfolders = await getAllSubfolders(folderId)
            const folderIds = [folderId, ...subfolders.map(f => f._id)]

            // Delete all documents in these folders
            await Document.deleteMany({
                folder: { $in: folderIds },
            })

            // Delete all subfolders
            await Folder.deleteMany({
                _id: { $in: folderIds },
            })

            res.status(200).json({
                success: true,
                message: 'Folder and all contents deleted',
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Share folder with other users (set isPublic)
    static async shareFolder(req, res) {
        try {
            const { folderId } = req.params
            const { isPublic } = req.body
            const userId = req.user.userId

            const folder = await Folder.findById(folderId)

            if (!folder) {
                return res.status(404).json({
                    success: false,
                    message: 'Folder not found',
                })
            }

            // Check permission
            if (folder.owner.toString() !== userId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied',
                })
            }

            folder.isPublic = isPublic
            await folder.save()

            res.status(200).json({
                success: true,
                data: folder,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }
}

module.exports = FolderController
