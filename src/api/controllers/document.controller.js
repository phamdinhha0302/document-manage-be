const { Document, Category, Tag, User } = require('../../schemas')
const mongoose = require('mongoose');
const path = require('path')
const fs = require('fs')

function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

class DocumentController {
    // Get all documents with filters
    static async getDocuments(req, res) {
        try {
            const { 
                category, 
                tags, 
                search, 
                page = 1, 
                limit = 10, 
                folder,
                sort = 'newest' // newest, relevance, a-z
            } = req.query;

            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);

            // 1. Giai đoạn MATCH: Lọc dữ liệu cơ bản (Permission + Filters)
            const matchStage = { $and: [] };

            // -- Quyền truy cập (Public hoặc của User) --
            if (req.user) {
                matchStage.$and.push({
                    $or: [
                        { isPublic: true },
                        { uploadedBy: new mongoose.Types.ObjectId(req.user.userId) }
                    ]
                });
            } else {
                matchStage.$and.push({ isPublic: true });
            }

            // -- Các Filter cơ bản --
            if (category) matchStage.$and.push({ category: new mongoose.Types.ObjectId(category) });
            if (folder) matchStage.$and.push({ folder: new mongoose.Types.ObjectId(folder) });
            
            if (tags) {
                const tagArray = Array.isArray(tags) ? tags : [tags];
                matchStage.$and.push({ tags: { $in: tagArray.map(id => new mongoose.Types.ObjectId(id)) } });
            }

            // 2. Giai đoạn SEARCH Logic (Core feature)
            let searchPipeline = [];
            
            if (search) {
                const cleanSearch = search.trim();
                let searchCondition = {};

                // A. Kiểm tra tìm kiếm chính xác (nếu để trong ngoặc kép "keyword")
                const isExactMatch = cleanSearch.startsWith('"') && cleanSearch.endsWith('"');
                
                if (isExactMatch) {
                    // Xóa ngoặc kép và tìm chính xác cụm từ
                    const exactTerm = escapeRegex(cleanSearch.replace(/"/g, ''));
                    const exactRegex = new RegExp(exactTerm, 'i'); // Case-insensitive nhưng đúng thứ tự
                    
                    searchCondition = {
                        $or: [
                            { title: exactRegex },
                            { description: exactRegex },
                            { fileName: exactRegex }
                        ]
                    };
                } else {
                    // B. Tìm kiếm Fuzzy / Tokenize (Tách từ)
                    // Ví dụ: "Hợp đồng 2024" -> tìm documents chứa cả "Hợp đồng" VÀ "2024" ở bất kỳ đâu
                    const words = cleanSearch.split(/\s+/).map(w => escapeRegex(w));
                    
                    // Tạo regex cho từng từ
                    const regexArray = words.map(w => new RegExp(w, 'i'));

                    searchCondition = {
                        $or: [
                            // 1. Title chứa TẤT CẢ các từ khóa (độ ưu tiên cao nhất logic)
                            { title: { $all: regexArray } },
                            // 2. Hoặc Description chứa
                            { description: { $all: regexArray } },
                            // 3. Hoặc OCR Content chứa (nếu muốn tìm sâu)
                            { ocrContent: { $all: regexArray } }
                        ]
                    };
                }
                
                matchStage.$and.push(searchCondition);

                // C. Tính điểm Relevance (Scoring) để sort
                // Title khớp -> 10 điểm, Description -> 5 điểm, OCR -> 1 điểm
                const keyword = isExactMatch ? cleanSearch.replace(/"/g, '') : cleanSearch;
                const scoreRegex = new RegExp(escapeRegex(keyword), 'i');

                searchPipeline.push({
                    $addFields: {
                        score: {
                            $add: [
                                // Điểm cho Title
                                { $cond: [{ $regexMatch: { input: "$title", regex: scoreRegex } }, 10, 0] },
                                // Điểm cho Description
                                { $cond: [{ $regexMatch: { input: "$description", regex: scoreRegex } }, 5, 0] },
                                // Điểm cho OCR
                                { $cond: [{ $regexMatch: { input: "$ocrContent", regex: scoreRegex } }, 1, 0] }
                            ]
                        }
                    }
                });
            }

            // Nếu matchStage rỗng (không có filter nào), xóa $and để tránh lỗi
            if (matchStage.$and.length === 0) delete matchStage.$and;

            // 3. Setup Pipeline Aggregation
            const pipeline = [
                { $match: matchStage },
                ...searchPipeline, // Thêm bước tính điểm nếu có search
            ];

            // 4. Sorting
            let sortStage = { createdAt: -1 }; // Mặc định: Mới nhất
            if (search && (!sort || sort === 'relevance')) {
                sortStage = { score: -1, createdAt: -1 }; // Ưu tiên độ khớp, sau đó mới đến ngày
            } else if (sort === 'a-z') {
                sortStage = { title: 1 };
            }

            pipeline.push({ $sort: sortStage });

            // 5. Facet cho Pagination (Lấy data + Đếm tổng số lượng trong 1 lần query)
            pipeline.push({
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $skip: (pageNum - 1) * limitNum },
                        { $limit: limitNum },
                        // Populate tương đương trong Aggregate ($lookup)
                        {
                            $lookup: {
                                from: 'categories', // Tên collection trong DB (thường là số nhiều, viết thường)
                                localField: 'category',
                                foreignField: '_id',
                                as: 'category'
                            }
                        },
                        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } }, // Aggregate trả về mảng, cần unwind để lấy object
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'uploadedBy',
                                foreignField: '_id',
                                pipeline: [{ $project: { fullName: 1, email: 1 } }], // Chỉ lấy field cần thiết
                                as: 'uploadedBy'
                            }
                        },
                        { $unwind: { path: '$uploadedBy', preserveNullAndEmptyArrays: true } },
                         {
                            $lookup: {
                                from: 'tags',
                                localField: 'tags',
                                foreignField: '_id',
                                as: 'tags'
                            }
                        },
                         {
                            $lookup: {
                                from: 'folders',
                                localField: 'folder',
                                foreignField: '_id',
                                as: 'folder'
                            }
                        },
                         { $unwind: { path: '$folder', preserveNullAndEmptyArrays: true } },
                    ]
                }
            });

            // Thực thi
            const result = await Document.aggregate(pipeline);

            const metadata = result[0].metadata[0];
            const documents = result[0].data;
            const total = metadata ? metadata.total : 0;

            res.status(200).json({
                success: true,
                data: documents,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    pages: Math.ceil(total / limitNum)
                }
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }

    // Get single document
    static async getDocument(req, res) {
        try {
            const { id } = req.params

            const document = await Document.findById(id)
                .populate('category')
                .populate('tags')
                .populate('uploadedBy', 'fullName email')

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found',
                })
            }

            // Increment views
            document.views += 1
            await document.save()

            res.status(200).json({
                success: true,
                data: document,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Upload document
    static async uploadDocument(req, res) {
        try {
            const { title, description, categoryId, tagIds = [], folderId } = req.body

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded',
                })
            }

            if (!title || !categoryId) {
                return res.status(400).json({
                    success: false,
                    message: 'Title and category are required',
                })
            }

            // Verify category exists
            const category = await Category.findById(categoryId)
            if (!category) {
                return res.status(404).json({
                    success: false,
                    message: 'Category not found',
                })
            }

            // Verify folder exists if provided
            let folder = null
            if (folderId) {
                const { Folder } = require('../../schemas')
                folder = await Folder.findById(folderId)
                if (!folder) {
                    return res.status(404).json({
                        success: false,
                        message: 'Folder not found',
                    })
                }
                // Check if user owns the folder
                if (folder.owner.toString() !== req.user.userId) {
                    return res.status(403).json({
                        success: false,
                        message: 'Access denied to this folder',
                    })
                }
            }

            // Determine file type
            const ext = path.extname(req.file.originalname).toLowerCase()
            let fileType = 'pdf'
            if (['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(ext)) {
                fileType = 'image'
            } else if (['.txt', '.doc', '.docx'].includes(ext)) {
                fileType = 'text'
            }

            // Create document
            const document = new Document({
                title,
                description,
                fileName: req.file.originalname,
                fileUrl: `/uploads/documents/${req.file.filename}`,
                fileSize: req.file.size,
                fileType,
                category: categoryId,
                tags: tagIds,
                folder: folderId || null,
                uploadedBy: req.user.userId,
                ocrContent: 'Mock OCR content - In production, call OCR API',
                aiClassification: 'Contract', // Mock classification
                aiConfidence: 0.92,
            })

            await document.save()

            // Populate references
            await document.populate('category')
            await document.populate('tags')
            await document.populate('uploadedBy', 'fullName email')
            await document.populate('folder')

            res.status(201).json({
                success: true,
                message: 'Document uploaded successfully',
                data: document,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Update document
    static async updateDocument(req, res) {
        try {
            const { id } = req.params
            const { title, description, categoryId, tagIds, notes } = req.body

            const document = await Document.findById(id)

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found',
                })
            }

            // Check if user is owner
            if (document.uploadedBy.toString() !== req.user.userId) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to update this document',
                })
            }

            // Update fields
            if (title) document.title = title
            if (description) document.description = description
            if (categoryId) document.category = categoryId
            if (tagIds) document.tags = tagIds
            if (notes) document.notes = notes

            await document.save()

            await document.populate('category')
            await document.populate('tags')
            await document.populate('uploadedBy', 'fullName email')

            res.status(200).json({
                success: true,
                message: 'Document updated successfully',
                data: document,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Delete document
    static async deleteDocument(req, res) {
        try {
            const { id } = req.params

            const document = await Document.findById(id)

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found',
                })
            }

            // Check if user is owner or admin
            if (document.uploadedBy.toString() !== req.user.userId && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to delete this document',
                })
            }

            // Delete file
            const filePath = path.join(__dirname, '../../..', 'uploads', 'documents', path.basename(document.fileUrl))
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)
            }

            await Document.findByIdAndDelete(id)

            res.status(200).json({
                success: true,
                message: 'Document deleted successfully',
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Search documents
    static async searchDocuments(req, res) {
        try {
            const { q, category, tags, page = 1, limit = 10 } = req.query

            let query = {}

            // If user is authenticated, show their documents too
            if (req.user) {
                query = {
                    $or: [{ isPublic: true }, { uploadedBy: req.user.userId }],
                }
            } else {
                query = { isPublic: true }
            }

            // Fuzzy search on keywords if provided
            if (q) {
                const fuzzyRegex = new RegExp(q, 'i')
                query.$or = [
                    { title: fuzzyRegex },
                    { description: fuzzyRegex },
                    { ocrContent: fuzzyRegex },
                ]
                
                // Need to restructure query if we have auth conditions
                if (req.user) {
                    query = {
                        $and: [
                            {
                                $or: [
                                    { title: fuzzyRegex },
                                    { description: fuzzyRegex },
                                    { ocrContent: fuzzyRegex },
                                ],
                            },
                            {
                                $or: [{ isPublic: true }, { uploadedBy: req.user.userId }],
                            },
                        ],
                    }
                } else {
                    query = {
                        $and: [
                            {
                                $or: [
                                    { title: fuzzyRegex },
                                    { description: fuzzyRegex },
                                    { ocrContent: fuzzyRegex },
                                ],
                            },
                            { isPublic: true },
                        ],
                    }
                }
            }

            // Filter by category
            if (category) {
                if (query.$and) {
                    query.$and.push({ category })
                } else {
                    query.category = category
                }
            }

            // Filter by tags
            if (tags) {
                const tagArray = Array.isArray(tags) ? tags : [tags]
                if (query.$and) {
                    query.$and.push({ tags: { $in: tagArray } })
                } else {
                    query.tags = { $in: tagArray }
                }
            }

            const skip = (page - 1) * limit

            const documents = await Document.find(query)
                .populate('category')
                .populate('tags')
                .populate('uploadedBy', 'fullName email')
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 })

            const total = await Document.countDocuments(query)

            res.status(200).json({
                success: true,
                data: documents,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(total / limit),
                },
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Download document
    static async downloadDocument(req, res) {
        try {
            const { id } = req.params

            const document = await Document.findById(id)

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found',
                })
            }

            // Increment downloads
            document.downloads += 1
            await document.save()

            const filePath = path.join(__dirname, '../../..', 'uploads', 'documents', path.basename(document.fileUrl))

            res.download(filePath, document.fileName, (err) => {
                if (err) {
                    console.error('Download error:', err)
                }
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // Summarize document using Gemini
    static async summarizeDocument(req, res) {
        try {
            const { id } = req.params

            const document = await Document.findById(id)

            if (!document) {
                return res.status(404).json({
                    success: false,
                    message: 'Document not found',
                })
            }

            // Check if summary already exists
            if (document.summary) {
                return res.status(200).json({
                    success: true,
                    data: {
                        documentId: document._id,
                        summary: document.summary,
                        cached: true,
                    },
                })
            }

            // Get file path and extension
            const filePath = path.join(__dirname, '../../..', 'uploads', 'documents', path.basename(document.fileUrl))
            const ext = path.extname(document.fileUrl).toLowerCase()
            
            if (!fs.existsSync(filePath)) {
                return res.status(400).json({
                    success: false,
                    message: 'Document file not found',
                })
            }

            // Initialize Gemini API
            const { GoogleGenerativeAI } = require('@google/generative-ai')
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
            
            // Try models in order: primary, then fallbacks (stable models that support generateContent)
            const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']
            let summary = ''
            let lastError = null

            // Try each model until one succeeds
            for (const modelName of models) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName })
                    console.log(`[Summary] Attempting with model: ${modelName}`)
                    
                    // Handle text files directly
                    if (['.txt', '.md'].includes(ext)) {
                        const fileContent = fs.readFileSync(filePath, 'utf-8')
                        
                        const prompt = `Bạn là một chuyên gia phân tích tài liệu. Hãy đọc nội dung được trích xuất từ file (PDF, Docx hoặc Ảnh) sau đây:

                "${fileContent}"

                Nhiệm vụ của bạn:
                1. Xác định nội dung chính/chủ đề cốt lõi của tài liệu là gì.
                2. Tóm tắt các điểm quan trọng nhất trong khoảng 3-5 câu.

                Yêu cầu:
                - Trình bày mạch lạc, đi thẳng vào vấn đề.
                - Tổng độ dài không quá 300 chữ.
                - Ngôn ngữ: Tiếng Việt.`;
                        
                        const result = await model.generateContent(prompt)
                        summary = result.response.text()
                        console.log(`✅ [Summary] Successfully generated with model: ${modelName}`)
                        break
                    } 
                    // Handle images and PDFs with vision model
                    else {
                        // Determine MIME type
                        let mimeType = 'application/octet-stream'
                        if (ext === '.pdf') {
                            mimeType = 'application/pdf'
                        } else if (['.jpg', '.jpeg'].includes(ext)) {
                            mimeType = 'image/jpeg'
                        } else if (ext === '.png') {
                            mimeType = 'image/png'
                        } else if (ext === '.gif') {
                            mimeType = 'image/gif'
                        }

                        // Read file and convert to base64
                        const fileData = fs.readFileSync(filePath)
                        const base64Data = fileData.toString('base64')

                        const prompt = `Bạn là một chuyên gia phân tích tài liệu. Hãy đọc nội dung được trích xuất từ file (PDF, Docx hoặc Ảnh) sau đây:
                Nhiệm vụ của bạn:
                1. Xác định nội dung chính/chủ đề cốt lõi của tài liệu là gì.
                2. Tóm tắt các điểm quan trọng nhất trong khoảng 3-5 câu.

                Yêu cầu:
                - Trình bày mạch lạc, đi thẳng vào vấn đề.
                - Tổng độ dài không quá 300 chữ.
                - Ngôn ngữ: Tiếng Việt.`;

                        const result = await model.generateContent([
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data,
                                },
                            },
                            prompt,
                        ])

                        summary = result.response.text()
                        console.log(`✅ [Summary] Successfully generated with model: ${modelName}`)
                        break
                    }
                } catch (error) {
                    lastError = error
                    const errorMsg = error.message || ''
                    console.log(`⚠️ [Summary] Model ${modelName} failed: ${errorMsg}`)
                    
                    // Check if it's a rate limit/overload error - try next model
                    if (errorMsg.includes('503') || errorMsg.includes('429') || errorMsg.includes('overload')) {
                        console.log(`[Summary] Retrying with next model...`)
                        continue
                    }
                    
                    // For other errors, stop trying
                    throw error
                }
            }

            // If all models failed
            if (!summary) {
                throw new Error(`All models failed. Last error: ${lastError?.message || 'Unknown error'}`)
            }

            // Save summary to database
            document.summary = summary
            await document.save()

            res.status(200).json({
                success: true,
                data: {
                    documentId: document._id,
                    summary: summary,
                    cached: false,
                },
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }
}

module.exports = DocumentController
