const { Document, Category, Tag, User } = require("../../schemas");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Tính khoảng cách Levenshtein giữa 2 chuỗi
 */
function levenshteinDistance(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const len1 = s1.length;
  const len2 = s2.length;

  const dp = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }

  return dp[len1][len2];
}

/**
 * Tính độ tương đồng Levenshtein (0-1)
 */
function levenshteinSimilarity(str1, str2) {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

/**
 * Tính Jaccard Similarity
 */
function jaccardSimilarity(str1, str2) {
  const set1 = new Set(
    str1
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  );
  const set2 = new Set(
    str2
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  );

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Tính điểm tổng hợp
 */
function calculateHybridScore(
  searchTerm,
  targetText,
  weights = { levenshtein: 0.3, jaccard: 0.7 }
) {
  if (!targetText) return 0;

  const levScore = levenshteinSimilarity(searchTerm, targetText);
  const jaccardScore = jaccardSimilarity(searchTerm, targetText);

  return levScore * weights.levenshtein + jaccardScore * weights.jaccard;
}

/**
 * Kiểm tra fuzzy match cho 1 từ trong chuỗi
 * Trả về true nếu có bất kỳ từ nào trong targetText có similarity >= threshold
 */
function fuzzyMatchWord(word, targetText, threshold = 0.7) {
  if (!targetText) return false;

  const targetWords = targetText.toLowerCase().split(/\s+/);
  const wordLower = word.toLowerCase();

  // Kiểm tra exact match trước (nhanh nhất)
  if (targetWords.some((w) => w.includes(wordLower))) return true;

  // Kiểm tra Levenshtein với từng từ
  return targetWords.some((targetWord) => {
    if (targetWord.length === 0) return false;
    return levenshteinSimilarity(wordLower, targetWord) >= threshold;
  });
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
        sort = "newest",
        fuzzyThreshold = 0.6, // Ngưỡng fuzzy matching
        enableFuzzy = "true", // Bật/tắt fuzzy search
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const threshold = parseFloat(fuzzyThreshold);
      const useFuzzy = enableFuzzy === "true";

      // 1. Giai đoạn MATCH: Lọc dữ liệu cơ bản
      const matchStage = { $and: [] };

      // Quyền truy cập
      if (req.user) {
        matchStage.$and.push({
          $or: [
            { isPublic: true },
            { uploadedBy: new mongoose.Types.ObjectId(req.user.userId) },
          ],
        });
      } else {
        matchStage.$and.push({ isPublic: true });
      }

      // Các Filter cơ bản
      if (category)
        matchStage.$and.push({
          category: new mongoose.Types.ObjectId(category),
        });
      if (folder)
        matchStage.$and.push({ folder: new mongoose.Types.ObjectId(folder) });

      if (tags) {
        const tagArray = Array.isArray(tags) ? tags : [tags];
        matchStage.$and.push({
          tags: { $in: tagArray.map((id) => new mongoose.Types.ObjectId(id)) },
        });
      }

      // ============================================
      // 2. SEARCH Logic - KHÔNG FILTER NGHIÊM NGẶT
      // ============================================
      let searchPipeline = [];

      if (search) {
        const cleanSearch = search.trim();
        const isExactMatch =
          cleanSearch.startsWith('"') && cleanSearch.endsWith('"');

        if (isExactMatch) {
          // Tìm chính xác cụm từ
          const exactTerm = escapeRegex(cleanSearch.replace(/"/g, ""));
          const exactRegex = new RegExp(exactTerm, "i");

          matchStage.$and.push({
            $or: [
              { title: exactRegex },
              { description: exactRegex },
              { fileName: exactRegex },
              { ocrContent: exactRegex },
            ],
          });
        } else if (!useFuzzy) {
          // Regex matching thông thường (nếu tắt fuzzy)
          const words = cleanSearch.split(/\s+/).map((w) => escapeRegex(w));

          matchStage.$and.push({
            $or: [
              { title: { $regex: new RegExp(words.join("|"), "i") } },
              { description: { $regex: new RegExp(words.join("|"), "i") } },
              { fileName: { $regex: new RegExp(words.join("|"), "i") } },
              { ocrContent: { $regex: new RegExp(words.join("|"), "i") } },
            ],
          });
        }
        // Nếu useFuzzy = true, KHÔNG thêm filter $match cho search
        // Để lấy TẤT CẢ documents, sau đó filter bằng fuzzy score
      }

      if (matchStage.$and.length === 0) delete matchStage.$and;

      // 3. Setup Pipeline
      const pipeline = [{ $match: matchStage }];

      // 4. Sorting (tạm thời, sẽ re-sort sau nếu dùng fuzzy)
      let sortStage = { createdAt: -1 };
      if (!search || sort === "a-z") {
        sortStage = sort === "a-z" ? { title: 1 } : { createdAt: -1 };
      }

      pipeline.push({ $sort: sortStage });

      // 5. Facet cho Pagination - LẤY NHIỀU HƠN ĐỂ FILTER SAU
      const fetchLimit = search && useFuzzy ? limitNum * 10 : limitNum; // Lấy 10x để filter

      pipeline.push({
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: 0 }, // Lấy từ đầu
            { $limit: fetchLimit },
            {
              $lookup: {
                from: "categories",
                localField: "category",
                foreignField: "_id",
                as: "category",
              },
            },
            {
              $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
            },
            {
              $lookup: {
                from: "users",
                localField: "uploadedBy",
                foreignField: "_id",
                pipeline: [{ $project: { fullName: 1, email: 1 } }],
                as: "uploadedBy",
              },
            },
            {
              $unwind: {
                path: "$uploadedBy",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "tags",
                localField: "tags",
                foreignField: "_id",
                as: "tags",
              },
            },
            {
              $lookup: {
                from: "folders",
                localField: "folder",
                foreignField: "_id",
                as: "folder",
              },
            },
            { $unwind: { path: "$folder", preserveNullAndEmptyArrays: true } },
          ],
        },
      });

      // Thực thi
      const result = await Document.aggregate(pipeline);
      let documents = result[0].data;

      // ============================================
      // 6. FUZZY MATCHING + SCORING (Core Logic)
      // ============================================
      if (search && useFuzzy) {
        const cleanSearch = search.trim().replace(/"/g, "");
        const searchWords = cleanSearch.toLowerCase().split(/\s+/);

        documents = documents.map((doc) => {
          // Tính fuzzy score cho từng field
          const titleText = doc.title || "";
          const descText = doc.description || "";
          const fileNameText = doc.fileName || "";
          const ocrText = doc.ocrContent || "";

          // A. Regex exact match score (bonus)
          let regexScore = 0;
          const searchRegex = new RegExp(escapeRegex(cleanSearch), "i");
          if (searchRegex.test(titleText)) regexScore += 10;
          if (searchRegex.test(descText)) regexScore += 5;
          if (searchRegex.test(fileNameText)) regexScore += 8;
          if (searchRegex.test(ocrText)) regexScore += 2;

          // B. Fuzzy matching với từng từ
          let fuzzyMatchCount = 0;
          let totalWords = searchWords.length;

          searchWords.forEach((word) => {
            // Kiểm tra từng field có match với word này không
            const matchInTitle = fuzzyMatchWord(word, titleText, 0.7);
            const matchInDesc = fuzzyMatchWord(word, descText, 0.7);
            const matchInFileName = fuzzyMatchWord(word, fileNameText, 0.7);
            const matchInOCR = fuzzyMatchWord(word, ocrText, 0.7);

            if (matchInTitle || matchInDesc || matchInFileName || matchInOCR) {
              fuzzyMatchCount++;
            }
          });

          const fuzzyMatchRatio =
            totalWords > 0 ? fuzzyMatchCount / totalWords : 0;

          // C. Hybrid Score (Levenshtein + Jaccard) cho toàn bộ query
          const titleScore = calculateHybridScore(cleanSearch, titleText, {
            levenshtein: 0.4,
            jaccard: 0.6,
          });
          const descScore = calculateHybridScore(cleanSearch, descText, {
            levenshtein: 0.3,
            jaccard: 0.7,
          });
          const fileNameScore = calculateHybridScore(
            cleanSearch,
            fileNameText,
            { levenshtein: 0.4, jaccard: 0.6 }
          );
          const ocrScore = calculateHybridScore(cleanSearch, ocrText, {
            levenshtein: 0.2,
            jaccard: 0.8,
          });

          // D. Tổng hợp điểm
          const hybridScore =
            titleScore * 10 + descScore * 5 + fileNameScore * 8 + ocrScore * 2;
          const fuzzyWordBonus = fuzzyMatchRatio * 15; // Bonus nếu match nhiều từ
          const finalScore = regexScore + hybridScore + fuzzyWordBonus;

          return {
            ...doc,
            _searchDebug: {
              regexScore: parseFloat(regexScore.toFixed(2)),
              hybridScore: parseFloat(hybridScore.toFixed(2)),
              fuzzyWordBonus: parseFloat(fuzzyWordBonus.toFixed(2)),
              fuzzyMatchRatio: parseFloat(fuzzyMatchRatio.toFixed(2)),
              titleScore: parseFloat(titleScore.toFixed(2)),
              descScore: parseFloat(descScore.toFixed(2)),
              fileNameScore: parseFloat(fileNameScore.toFixed(2)),
              ocrScore: parseFloat(ocrScore.toFixed(2)),
            },
            finalScore: parseFloat(finalScore.toFixed(2)),
          };
        });

        // E. Filter theo threshold
        const minScore = threshold * 20; // Scale threshold (0-1) -> (0-20)
        documents = documents.filter((doc) => doc.finalScore >= minScore);

        // F. Sort theo score
        if (!sort || sort === "relevance") {
          documents.sort((a, b) => b.finalScore - a.finalScore);
        } else if (sort === "a-z") {
          documents.sort((a, b) =>
            (a.title || "").localeCompare(b.title || "")
          );
        }
      }

      // 7. Pagination SAU KHI filter
      const total = documents.length;
      const startIdx = (pageNum - 1) * limitNum;
      const paginatedDocs = documents.slice(startIdx, startIdx + limitNum);

      res.status(200).json({
        success: true,
        data: paginatedDocs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
        searchInfo: search
          ? {
              query: search,
              fuzzyEnabled: useFuzzy,
              fuzzyThreshold: threshold,
              minScoreRequired: threshold * 20,
              algorithmsUsed: useFuzzy
                ? [
                    "Levenshtein Distance",
                    "Jaccard Similarity",
                    "Word-level Fuzzy Matching",
                    "Regex Matching",
                  ]
                : ["Regex Matching"],
            }
          : undefined,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get single document
  static async getDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id)
        .populate("category")
        .populate("tags")
        .populate("uploadedBy", "fullName email");

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // Increment views
      document.views += 1;
      await document.save();

      res.status(200).json({
        success: true,
        data: document,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Upload document
  static async uploadDocument(req, res) {
    try {
      const {
        title,
        description,
        categoryId,
        tagIds = [],
        folderId,
      } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      if (!title || !categoryId) {
        return res.status(400).json({
          success: false,
          message: "Title and category are required",
        });
      }

      // Verify category exists
      const category = await Category.findById(categoryId);
      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      // Verify folder exists if provided
      let folder = null;
      if (folderId) {
        const { Folder } = require("../../schemas");
        folder = await Folder.findById(folderId);
        if (!folder) {
          return res.status(404).json({
            success: false,
            message: "Folder not found",
          });
        }
        // Check if user owns the folder
        if (folder.owner.toString() !== req.user.userId) {
          return res.status(403).json({
            success: false,
            message: "Access denied to this folder",
          });
        }
      }

      // Determine file type
      const ext = path.extname(req.file.originalname).toLowerCase();
      let fileType = "pdf";
      if ([".jpg", ".jpeg", ".png", ".gif", ".bmp"].includes(ext)) {
        fileType = "image";
      } else if ([".txt", ".doc", ".docx"].includes(ext)) {
        fileType = "text";
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
        ocrContent: "",
        ocrLanguage: "eng",
        ocrConfidence: 0,
      });

      await document.save();

      // Populate references
      await document.populate("category");
      await document.populate("tags");
      await document.populate("uploadedBy", "fullName email");
      await document.populate("folder");

      res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: document,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update document
  static async updateDocument(req, res) {
    try {
      const { id } = req.params;
      const { title, description, categoryId, tagIds, notes } = req.body;

      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // Check if user is owner
      if (document.uploadedBy.toString() !== req.user.userId) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this document",
        });
      }

      // Update fields
      if (title) document.title = title;
      if (description) document.description = description;
      if (categoryId) document.category = categoryId;
      if (tagIds) document.tags = tagIds;
      if (notes) document.notes = notes;

      await document.save();

      await document.populate("category");
      await document.populate("tags");
      await document.populate("uploadedBy", "fullName email");

      res.status(200).json({
        success: true,
        message: "Document updated successfully",
        data: document,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete document
  static async deleteDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // Check if user is owner or admin
      if (
        document.uploadedBy.toString() !== req.user.userId &&
        req.user.role !== "admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to delete this document",
        });
      }

      // Delete file
      const filePath = path.join(
        __dirname,
        "../../..",
        "uploads",
        "documents",
        path.basename(document.fileUrl)
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await Document.findByIdAndDelete(id);

      res.status(200).json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Search documents
  static async searchDocuments(req, res) {
    try {
      const { q, category, tags, page = 1, limit = 10 } = req.query;

      let query = {};

      // If user is authenticated, show their documents too
      if (req.user) {
        query = {
          $or: [{ isPublic: true }, { uploadedBy: req.user.userId }],
        };
      } else {
        query = { isPublic: true };
      }

      // Fuzzy search on keywords if provided
      if (q) {
        const fuzzyRegex = new RegExp(q, "i");
        query.$or = [
          { title: fuzzyRegex },
          { description: fuzzyRegex },
          { ocrContent: fuzzyRegex },
        ];

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
          };
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
          };
        }
      }

      // Filter by category
      if (category) {
        if (query.$and) {
          query.$and.push({ category });
        } else {
          query.category = category;
        }
      }

      // Filter by tags
      if (tags) {
        const tagArray = Array.isArray(tags) ? tags : [tags];
        if (query.$and) {
          query.$and.push({ tags: { $in: tagArray } });
        } else {
          query.tags = { $in: tagArray };
        }
      }

      const skip = (page - 1) * limit;

      const documents = await Document.find(query)
        .populate("category")
        .populate("tags")
        .populate("uploadedBy", "fullName email")
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });

      const total = await Document.countDocuments(query);

      res.status(200).json({
        success: true,
        data: documents,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Download document
  static async downloadDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // Increment downloads
      document.downloads += 1;
      await document.save();

      const filePath = path.join(
        __dirname,
        "../../..",
        "uploads",
        "documents",
        path.basename(document.fileUrl)
      );

      res.download(filePath, document.fileName, (err) => {
        if (err) {
          console.error("Download error:", err);
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Summarize document using Gemini
  static async summarizeDocument(req, res) {
    try {
      const { id } = req.params;

      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
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
        });
      }

      // Get file path and extension
      const filePath = path.join(
        __dirname,
        "../../..",
        "uploads",
        "documents",
        path.basename(document.fileUrl)
      );
      const ext = path.extname(document.fileUrl).toLowerCase();

      if (!fs.existsSync(filePath)) {
        return res.status(400).json({
          success: false,
          message: "Document file not found",
        });
      }

      // Initialize Gemini API
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

      // Try models in order: primary, then fallbacks (stable models that support generateContent)
      const models = [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
      ];
      let summary = "";
      let lastError = null;

      // Try each model until one succeeds
      for (const modelName of models) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          console.log(`[Summary] Attempting with model: ${modelName}`);

          // Handle text files directly
          if ([".txt", ".md"].includes(ext)) {
            const fileContent = fs.readFileSync(filePath, "utf-8");

            const prompt = `Bạn là một chuyên gia phân tích tài liệu. Hãy đọc nội dung được trích xuất từ file (PDF, Docx hoặc Ảnh) sau đây:

                "${fileContent}"

                Nhiệm vụ của bạn:
                1. Xác định nội dung chính/chủ đề cốt lõi của tài liệu là gì.
                2. Tóm tắt các điểm quan trọng nhất trong khoảng 3-5 câu.

                Yêu cầu:
                - Trình bày mạch lạc, đi thẳng vào vấn đề.
                - Tổng độ dài không quá 300 chữ.
                - Ngôn ngữ: Tiếng Việt.`;

            const result = await model.generateContent(prompt);
            summary = result.response.text();
            console.log(
              `✅ [Summary] Successfully generated with model: ${modelName}`
            );
            break;
          }
          // Handle images and PDFs with vision model
          else {
            // Determine MIME type
            let mimeType = "application/octet-stream";
            if (ext === ".pdf") {
              mimeType = "application/pdf";
            } else if ([".jpg", ".jpeg"].includes(ext)) {
              mimeType = "image/jpeg";
            } else if (ext === ".png") {
              mimeType = "image/png";
            } else if (ext === ".gif") {
              mimeType = "image/gif";
            }

            // Read file and convert to base64
            const fileData = fs.readFileSync(filePath);
            const base64Data = fileData.toString("base64");

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
            ]);

            summary = result.response.text();
            console.log(
              `✅ [Summary] Successfully generated with model: ${modelName}`
            );
            break;
          }
        } catch (error) {
          lastError = error;
          const errorMsg = error.message || "";
          console.log(`⚠️ [Summary] Model ${modelName} failed: ${errorMsg}`);

          // Check if it's a rate limit/overload error - try next model
          if (
            errorMsg.includes("503") ||
            errorMsg.includes("429") ||
            errorMsg.includes("overload")
          ) {
            console.log(`[Summary] Retrying with next model...`);
            continue;
          }

          // For other errors, stop trying
          throw error;
        }
      }

      // If all models failed
      if (!summary) {
        throw new Error(
          `All models failed. Last error: ${
            lastError?.message || "Unknown error"
          }`
        );
      }

      // Save summary to database
      document.summary = summary;
      await document.save();

      res.status(200).json({
        success: true,
        data: {
          documentId: document._id,
          summary: summary,
          cached: false,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // OCR Processing - Call OCR API and save result
  static async processOCR(req, res) {
    try {
      const { id: documentId } = req.params;
      const { language = "eng" } = req.body;
      console.log(
        `[OCR] Starting OCR processing - DocumentID: ${documentId}, Language: ${language}`
      );

      if (!documentId) {
        return res.status(400).json({
          success: false,
          message: "documentId is required",
        });
      }

      // Find document
      console.log(`[OCR] Finding document with ID: ${documentId}`);
      const document = await Document.findById(documentId);
      if (!document) {
        console.error(`[OCR] Document not found: ${documentId}`);
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }
      console.log(`[OCR] Document found: ${document.title}`);

      // Check permission
      if (document.uploadedBy.toString() !== req.user?.userId) {
        console.error(
          `[OCR] Unauthorized: User ${req.user?.userId} vs Document owner ${document.uploadedBy}`
        );
        return res.status(403).json({
          success: false,
          message: "Not authorized",
        });
      }

      // Get file from disk (not URL)
      const filePath = path.join(
        __dirname,
        "../../..",
        "uploads",
        "documents",
        path.basename(document.fileUrl)
      );
      console.log(`[OCR] File path: ${filePath}`);

      if (!fs.existsSync(filePath)) {
        console.error(`[OCR] File not found: ${filePath}`);
        return res.status(404).json({
          success: false,
          message: "Document file not found on disk",
        });
      }

      const fileBuffer = fs.readFileSync(filePath);
      console.log(`[OCR] File size: ${fileBuffer.length} bytes`);

      // Call OCR API
      const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000";
      console.log(`[OCR] Calling OCR API: ${ocrApiUrl}/ocr/extract`);

      const formData = new FormData();
      // Lưu ý: filename là bắt buộc khi gửi buffer qua form-data
      formData.append("file", fileBuffer, { filename: document.fileName });
      formData.append("language", language);

      const ocrResponse = await axios.post(
        `${ocrApiUrl}/ocr/extract`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 180000,
        }
      );

      console.log(`[OCR] OCR API response received`);
      const { text, confidence, fields = [] } = ocrResponse.data;
      console.log(
        `[OCR] Extracted text length: ${
          text?.length || 0
        }, Confidence: ${confidence}, Fields: ${fields?.length || 0}`
      );

      // Save OCR result to database
      document.ocrContent = text || "";
      document.ocrLanguage = language;

      // --- FIX: Không nhân 100 nữa ---
      document.ocrConfidence = confidence * 100;

      // NEW: Save OCR fields and document type
      document.ocrFields = fields || [];

      await document.save();
      console.log(`[OCR] OCR result saved to database`);

      res.status(200).json({
        success: true,
        data: {
          documentId: document._id,
          ocrContent: text,
          ocrLanguage: language,
          ocrConfidence: document.ocrConfidence,
          ocrFields: document.ocrFields,
          documentType: document.documentType,
          message: "OCR processing completed",
        },
      });
    } catch (error) {
      console.error("❌ [OCR] Error:", error);
      console.error("❌ [OCR] Error message:", error.message);

      if (error.response) {
        console.error("❌ [OCR] API Error Status:", error.response.status);
        console.error("❌ [OCR] API Error Data:", error.response.data);
      }

      res.status(500).json({
        success: false,
        message: error.message || "OCR processing failed",
        details: error.response?.data || error.stack,
      });
    }
  }

  // Upload and Process OCR in one request
  static async uploadAndProcessOCR(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file provided",
        });
      }

      const {
        title,
        description = "",
        category,
        tags,
        language = "eng",
        isPublic = false,
      } = req.body;

      if (!title || !category) {
        return res.status(400).json({
          success: false,
          message: "title and category are required",
        });
      }

      // Save file and create document
      const fileBuffer = req.file.buffer;
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const uploadDir = path.join(
        __dirname,
        "../../..",
        "uploads",
        "documents"
      );

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, fileBuffer);

      const fileUrl = `/uploads/documents/${fileName}`;
      const fileType = req.file.mimetype.split("/")[1] || "unknown";
      const fileSize = req.file.size;

      // Create document
      const newDocument = new Document({
        title,
        description,
        fileName,
        fileUrl,
        fileSize,
        fileType,
        category: new mongoose.Types.ObjectId(category),
        tags: tags
          ? tags.split(",").map((id) => new mongoose.Types.ObjectId(id.trim()))
          : [],
        uploadedBy: new mongoose.Types.ObjectId(req.user.userId),
        isPublic: isPublic === "true" || isPublic === true,
      });

      await newDocument.save();
      // Populate để trả về data đẹp hơn
      await newDocument.populate(
        "category tags uploadedBy",
        "name color fullName"
      );

      // Process OCR
      const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000";

      // --- FIX: Dùng Buffer chuẩn thay vì Blob để tránh lỗi tương thích Node.js ---
      const formData = new FormData();
      formData.append("file", fileBuffer, {
        filename: fileName,
        contentType: req.file.mimetype,
      });
      formData.append("language", language);

      try {
        const ocrResponse = await axios.post(
          `${ocrApiUrl}/ocr/extract`,
          formData,
          {
            headers: formData.getHeaders(), // Dùng getHeaders() chuẩn của thư viện form-data
            timeout: 180000,
          }
        );

        const { text, confidence, fields = [] } = ocrResponse.data;
        newDocument.ocrContent = text || "";
        newDocument.ocrLanguage = language;

        // --- FIX: Không nhân 100 nữa ---
        newDocument.ocrConfidence = confidence * 100;

        // NEW: Save OCR fields and document type
        newDocument.ocrFields = fields || [];

        await newDocument.save();
      } catch (ocrError) {
        console.warn("OCR processing warning:", ocrError.message);
        // Continue even if OCR fails (tùy nghiệp vụ, ở đây cho phép upload thành công dù OCR lỗi)
      }

      res.status(201).json({
        success: true,
        data: {
          document: newDocument,
          ocrProcessed: !!newDocument.ocrContent,
        },
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Upload and OCR processing failed",
      });
    }
  }
}

module.exports = DocumentController;
