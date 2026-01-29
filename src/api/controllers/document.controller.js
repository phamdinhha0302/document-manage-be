const { Document, Category, Tag, User } = require("../../schemas");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { normalizeSearchText, removeVietnameseAccents } = require("../../utils");
// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Constants
const MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite-001",
  "gemini-3-flash-preview",
];

const GENERATION_CONFIG = {
  temperature: 0.3,
  responseMimeType: "application/json", // Force JSON response
};

const FILE_CONFIG = {
  MAX_CONTENT_SIZE: 5000,
  FILENAME_PREVIEW_SIZE: 500,
  CATEGORY_PREVIEW_SIZE: 800,
  FILENAME_MAX_LENGTH: 50,
};

const MIME_TYPE_MAP = {
  pdf: "application/pdf",
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
};

/**
 * Run Gemini AI with retry logic and JSON parsing
 */
async function runGemini(prompt, responseSchema = null) {
  let lastError = null;

  for (const modelName of MODEL_PRIORITY) {
    try {
      const config = { ...GENERATION_CONFIG };
      if (responseSchema) {
        config.responseSchema = responseSchema;
      }

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: config,
      });

      const result = await model.generateContent(prompt);
      let text = result.response.text();

      // Clean markdown code blocks
      text = text.replace(/```(?:json)?\s*/g, "").trim();

      return JSON.parse(text);
    } catch (error) {
      lastError = error;

      // Retry on server errors or rate limits
      if (error.message?.includes("503") || error.message?.includes("429")) {
        console.warn(`⚠️ Model ${modelName} unavailable, retrying...`);
        continue;
      }

      // Retry on JSON parse errors
      if (error instanceof SyntaxError) {
        console.warn(
          `⚠️ Model ${modelName} returned invalid JSON, retrying...`
        );
        continue;
      }

      // Don't retry on other errors
      throw error;
    }
  }

  throw new Error(
    `All Gemini models failed: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * Normalize file type to extension
 */
function normalizeFileType(fileType) {
  if (!fileType || typeof fileType !== "string") {
    throw new Error("Invalid file type");
  }

  const type = fileType.toLowerCase();

  // Already an extension
  if (!type.includes("/")) {
    return type;
  }

  // Convert MIME type to extension
  const mimeTypeMap = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "word",
    "application/msword": "word",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "text/plain": "text",
    "text/markdown": "markdown",
  };

  const normalized = mimeTypeMap[type];
  if (normalized) {
    return normalized;
  }

  // Fallback: extract from MIME type string
  if (type.includes("pdf")) return "pdf";
  if (type.includes("word") || type.includes("officedocument")) return "word";
  if (type.includes("image")) {
    if (type.includes("png")) return "png";
    if (type.includes("gif")) return "gif";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpeg";
    if (type.includes("bmp")) return "bmp";
    return "image";
  }
  if (type.includes("text") || type.includes("plain")) return "text";
  if (type.includes("markdown")) return "markdown";

  throw new Error(`Unsupported MIME type: ${fileType}`);
}

/**
 * Extract text content using Gemini Vision
 */
async function extractWithGemini(base64Data, mimeType, fileType) {
  // BUG FIX: Validate base64Data exists before calling toString
  if (!base64Data) {
    throw new Error(`File buffer is empty or invalid for ${fileType}`);
  }

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt =
    fileType === "image"
      ? "Hãy mô tả chi tiết nội dung, chủ đề, và các thông tin quan trọng trong ảnh này. Trả lời bằng tiếng Việt."
      : "Hãy trích xuất toàn bộ nội dung văn bản từ tài liệu này. Trả lời bằng tiếng Việt.";

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Data,
      },
    },
    { text: prompt },
  ]);

  const content = result.response.text();

  if (!content?.trim()) {
    throw new Error(`${fileType} file appears to be empty or unreadable`);
  }

  return content;
}

/**
 * Extract content from different file types
 */
async function extractFileContent(
  fileBuffer,
  fileType,
  maxSize = FILE_CONFIG.MAX_CONTENT_SIZE
) {
  // BUG FIX: Validate fileBuffer exists
  if (!fileBuffer) {
    throw new Error("File buffer is required");
  }

  try {
    const ext = normalizeFileType(fileType);
    let content = "";

    // Text files
    if (ext === "text" || ext === "plain" || ext === "markdown") {
      content = fileBuffer.toString("utf-8");

      if (!content?.trim()) {
        throw new Error("Text file is empty or unreadable");
      }
    }
    // PDF and Word files
    else if (ext === "pdf" || ext === "word") {
      const base64Data = fileBuffer.toString("base64");
      const mimeType = MIME_TYPE_MAP[ext];

      content = await extractWithGemini(
        base64Data,
        mimeType,
        ext.toUpperCase()
      );
      console.log(`[Extract] ${ext.toUpperCase()} analyzed by Gemini`);
    }
    // Image files
    else if (["image", "jpeg", "png", "gif", "jpg", "bmp"].includes(ext)) {
      const base64Data = fileBuffer.toString("base64");
      const mimeType = MIME_TYPE_MAP[ext] || MIME_TYPE_MAP.jpeg;

      content = await extractWithGemini(base64Data, mimeType, "image");
      console.log(`[Extract] Image analyzed by Gemini`);
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    // Truncate if needed
    if (content.length > maxSize) {
      console.log(
        `[Extract] Content truncated from ${content.length} to ${maxSize} chars`
      );
      content = content.substring(0, maxSize) + "... [content truncated]";
    }

    return content;
  } catch (error) {
    console.error("[Extract] Error:", error.message);
    throw error;
  }
}

/**
 * Clean and validate filename
 */
function cleanFileName(name) {
  if (!name || typeof name !== "string") {
    throw new Error("Invalid filename");
  }

  const cleaned = name
    .toLowerCase()
    .normalize("NFD") // Normalize Vietnamese characters
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9-]/g, "-") // Replace special chars with dash
    .replace(/-+/g, "-") // Remove consecutive dashes
    .replace(/^-|-$/g, ""); // Remove leading/trailing dashes

  if (!cleaned) {
    throw new Error("Filename becomes empty after cleaning");
  }

  // Truncate if too long
  if (cleaned.length > FILE_CONFIG.FILENAME_MAX_LENGTH) {
    return cleaned.substring(0, FILE_CONFIG.FILENAME_MAX_LENGTH);
  }

  return cleaned;
}

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
          // Hỗ trợ tìm kiếm tiếng Việt không dấu
          const normalizedExactTerm = escapeRegex(normalizeSearchText(cleanSearch.replace(/"/g, "")));
          const normalizedExactRegex = new RegExp(normalizedExactTerm, "i");

          matchStage.$and.push({
            $or: [
              // Tìm trên field gốc
              { title: exactRegex },
              { description: exactRegex },
              { fileName: exactRegex },
              { ocrContent: exactRegex },
              // Tìm trên field đã bỏ dấu (Vietnamese accent-insensitive)
              { titleSearch: normalizedExactRegex },
              { descriptionSearch: normalizedExactRegex },
              { fileNameSearch: normalizedExactRegex },
              { ocrContentSearch: normalizedExactRegex },
            ],
          });
        } else if (!useFuzzy) {
          // Regex matching thông thường (nếu tắt fuzzy)
          // Hỗ trợ tìm kiếm tiếng Việt không dấu
          const words = cleanSearch.split(/\s+/).map((w) => escapeRegex(w));
          const normalizedSearch = normalizeSearchText(cleanSearch);
          const normalizedWords = normalizedSearch.split(/\s+/).map((w) => escapeRegex(w));

          matchStage.$and.push({
            $or: [
              // Tìm trên field gốc với từ khóa gốc
              { title: { $regex: new RegExp(words.join("|"), "i") } },
              { description: { $regex: new RegExp(words.join("|"), "i") } },
              { fileName: { $regex: new RegExp(words.join("|"), "i") } },
              { ocrContent: { $regex: new RegExp(words.join("|"), "i") } },
              // Tìm trên field đã bỏ dấu với từ khóa đã bỏ dấu (Vietnamese accent-insensitive)
              { titleSearch: { $regex: new RegExp(normalizedWords.join("|"), "i") } },
              { descriptionSearch: { $regex: new RegExp(normalizedWords.join("|"), "i") } },
              { fileNameSearch: { $regex: new RegExp(normalizedWords.join("|"), "i") } },
              { ocrContentSearch: { $regex: new RegExp(normalizedWords.join("|"), "i") } },
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
          // Tính fuzzy score cho từng field (cả gốc và đã bỏ dấu)
          const titleText = doc.title || "";
          const descText = doc.description || "";
          const fileNameText = doc.fileName || "";
          const ocrText = doc.ocrContent || "";
          
          // Fields đã bỏ dấu cho Vietnamese accent-insensitive search
          const titleSearchText = doc.titleSearch || "";
          const descSearchText = doc.descriptionSearch || "";
          const fileNameSearchText = doc.fileNameSearch || "";
          const ocrSearchText = doc.ocrContentSearch || "";
          
          // Normalize search query for Vietnamese
          const normalizedSearch = normalizeSearchText(cleanSearch);
          const normalizedSearchWords = normalizedSearch.split(/\s+/);

          // A. Regex exact match score (bonus) - cả gốc và đã bỏ dấu
          let regexScore = 0;
          const searchRegex = new RegExp(escapeRegex(cleanSearch), "i");
          const normalizedSearchRegex = new RegExp(escapeRegex(normalizedSearch), "i");
          
          // Match trên field gốc
          if (searchRegex.test(titleText)) regexScore += 10;
          if (searchRegex.test(descText)) regexScore += 5;
          if (searchRegex.test(fileNameText)) regexScore += 8;
          if (searchRegex.test(ocrText)) regexScore += 2;
          
          // Match trên field đã bỏ dấu (Vietnamese accent-insensitive)
          if (normalizedSearchRegex.test(titleSearchText)) regexScore += 10;
          if (normalizedSearchRegex.test(descSearchText)) regexScore += 5;
          if (normalizedSearchRegex.test(fileNameSearchText)) regexScore += 8;
          if (normalizedSearchRegex.test(ocrSearchText)) regexScore += 2;

          // B. Fuzzy matching với từng từ (cả gốc và đã bỏ dấu)
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
          
          // Fuzzy matching với từ đã normalize (Vietnamese accent-insensitive)
          normalizedSearchWords.forEach((word) => {
            const matchInTitleSearch = fuzzyMatchWord(word, titleSearchText, 0.7);
            const matchInDescSearch = fuzzyMatchWord(word, descSearchText, 0.7);
            const matchInFileNameSearch = fuzzyMatchWord(word, fileNameSearchText, 0.7);
            const matchInOCRSearch = fuzzyMatchWord(word, ocrSearchText, 0.7);

            if (matchInTitleSearch || matchInDescSearch || matchInFileNameSearch || matchInOCRSearch) {
              fuzzyMatchCount++;
            }
          });

          const fuzzyMatchRatio =
            totalWords > 0 ? fuzzyMatchCount / (totalWords * 2) : 0; // *2 vì check cả gốc và normalized

          // C. Hybrid Score (Levenshtein + Jaccard) cho toàn bộ query
          // Score trên field gốc
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
          
          // Score trên field đã bỏ dấu (Vietnamese accent-insensitive)
          const titleSearchScore = calculateHybridScore(normalizedSearch, titleSearchText, {
            levenshtein: 0.4,
            jaccard: 0.6,
          });
          const descSearchScore = calculateHybridScore(normalizedSearch, descSearchText, {
            levenshtein: 0.3,
            jaccard: 0.7,
          });
          const fileNameSearchScore = calculateHybridScore(
            normalizedSearch,
            fileNameSearchText,
            { levenshtein: 0.4, jaccard: 0.6 }
          );
          const ocrSearchScore = calculateHybridScore(normalizedSearch, ocrSearchText, {
            levenshtein: 0.2,
            jaccard: 0.8,
          });

          // D. Tổng hợp điểm (lấy max giữa gốc và normalized)
          const hybridScore =
            Math.max(titleScore, titleSearchScore) * 10 + 
            Math.max(descScore, descSearchScore) * 5 + 
            Math.max(fileNameScore, fileNameSearchScore) * 8 + 
            Math.max(ocrScore, ocrSearchScore) * 2;
          const fuzzyWordBonus = fuzzyMatchRatio * 15; // Bonus nếu match nhiều từ
          const finalScore = regexScore + hybridScore + fuzzyWordBonus;

          return {
            ...doc,
            _searchDebug: {
              regexScore: parseFloat(regexScore.toFixed(2)),
              hybridScore: parseFloat(hybridScore.toFixed(2)),
              fuzzyWordBonus: parseFloat(fuzzyWordBonus.toFixed(2)),
              fuzzyMatchRatio: parseFloat(fuzzyMatchRatio.toFixed(2)),
              titleScore: parseFloat(Math.max(titleScore, titleSearchScore).toFixed(2)),
              descScore: parseFloat(Math.max(descScore, descSearchScore).toFixed(2)),
              fileNameScore: parseFloat(Math.max(fileNameScore, fileNameSearchScore).toFixed(2)),
              ocrScore: parseFloat(Math.max(ocrScore, ocrSearchScore).toFixed(2)),
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

      console.log("[Upload] Request body:", {
        title,
        categoryId,
        tagIds,
        folderId,
      });

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      if (!title || !categoryId) {
        console.error("[Upload] Missing required fields:", {
          title,
          categoryId,
        });
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

      // Create document with search fields for Vietnamese accent-insensitive search
      const document = new Document({
        title,
        titleSearch: normalizeSearchText(title),
        description,
        descriptionSearch: normalizeSearchText(description || ""),
        fileName: req.file.originalname,
        fileNameSearch: normalizeSearchText(req.file.originalname),
        fileUrl: `/uploads/documents/${req.file.filename}`,
        fileSize: req.file.size,
        fileType,
        category: categoryId,
        tags: tagIds,
        folder: folderId || null,
        uploadedBy: req.user.userId,
        ocrContent: "",
        ocrContentSearch: "",
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

      // Update fields with search fields for Vietnamese accent-insensitive search
      if (title) {
        document.title = title;
        document.titleSearch = normalizeSearchText(title);
      }
      if (description) {
        document.description = description;
        document.descriptionSearch = normalizeSearchText(description);
      }
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

  // Search documents with Vietnamese accent-insensitive support
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

      // Fuzzy search on keywords if provided - with Vietnamese accent support
      if (q) {
        // Original search term (for exact match with accents)
        const fuzzyRegex = new RegExp(q, "i");
        
        // De-accented search term (for Vietnamese accent-insensitive search)
        const normalizedQuery = normalizeSearchText(q);
        const normalizedRegex = new RegExp(normalizedQuery, "i");
        
        // Search conditions:
        // 1. Original fields with original query (exact match with accents)
        // 2. Search fields with normalized query (accent-insensitive)
        // 3. Original fields with normalized query (for files without accents)
        const searchConditions = [
          // Original text search (for when user searches with correct accents)
          { title: fuzzyRegex },
          { description: fuzzyRegex },
          { ocrContent: fuzzyRegex },
          { fileName: fuzzyRegex },
          // Normalized search (for Vietnamese accent-insensitive)
          { titleSearch: normalizedRegex },
          { descriptionSearch: normalizedRegex },
          { ocrContentSearch: normalizedRegex },
          { fileNameSearch: normalizedRegex },
        ];

        // Need to restructure query if we have auth conditions
        if (req.user) {
          query = {
            $and: [
              { $or: searchConditions },
              {
                $or: [{ isPublic: true }, { uploadedBy: req.user.userId }],
              },
            ],
          };
        } else {
          query = {
            $and: [
              { $or: searchConditions },
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

      // Save OCR result to database with search field for Vietnamese accent-insensitive search
      document.ocrContent = text || "";
      document.ocrContentSearch = normalizeSearchText(text || "");
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

      // Create document with search fields for Vietnamese accent-insensitive search
      const newDocument = new Document({
        title,
        titleSearch: normalizeSearchText(title),
        description,
        descriptionSearch: normalizeSearchText(description || ""),
        fileName,
        fileNameSearch: normalizeSearchText(fileName),
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
        newDocument.ocrContentSearch = normalizeSearchText(text || "");
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

  /**
   * Classify and suggest filename based on content
   */
  static async classifyFileName(req, res) {
    try {
      // Validate file exists
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File is required",
        });
      }

      // Debug log
      console.log("[ClassifyFileName] File info:", {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        hasBuffer: !!req.file.buffer,
        hasPath: !!req.file.path,
      });

      // Get file buffer (handle both memory and disk storage)
      let fileBuffer = req.file.buffer;
            const fileType = req.body.fileType || req.file.mimetype || "unknown";
      const fileName = req.file.originalname;

      // Extract file content
      let fileContent;
      try {
        fileContent = await extractFileContent(fileBuffer, fileType, 4000);
        console.log("[ClassifyCategory] Extracted content:", fileContent);
      } catch (extractError) {
        console.error(
          "[ClassifyCategory] Content extraction failed:",
          extractError.message
        );
        return res.status(400).json({
          success: false,
          message: `Cannot process file: ${extractError.message}`,
        });
      }
      // AI prompt with schema
      const prompt = `
Nhiệm vụ: Đổi tên tệp tin sao cho chuyên nghiệp, chuẩn SEO, viết liền không dấu (kebab-case).
Dựa vào nội dung file để đề xuất tên phù hợp và có ý nghĩa.

Input:
- Tên cũ: "${req.file.originalname}"
- Loại: "${req.file.mimetype}"
- Nội dung file (preview): "${fileContent.substring(
        0,
        FILE_CONFIG.FILENAME_PREVIEW_SIZE
      )}"

Quy tắc:
1. PHẢI đặt tên dựa vào NỘI DUNG file, không được sử dụng lại tên cũ.
2. Chuyển tiếng Việt có dấu thành không dấu.
3. Thay khoảng trắng bằng dấu gạch ngang (-).
4. Giữ lại các con số quan trọng (ngày tháng, năm, phiên bản).
5. Tối đa ${FILE_CONFIG.FILENAME_MAX_LENGTH} ký tự.
6. Tên PHẢI có ý nghĩa phản ánh nội dung chính của file.

Ví dụ:
- "Báo cáo tài chính Q1 2024.pdf" -> "bao-cao-tai-chinh-q1-2024"
- "Hợp đồng lao động Nguyễn Văn A.docx" -> "hop-dong-lao-dong-nguyen-van-a"
- "IMG_20231010_123456.jpg" -> "anh-chup-2023-10-10"

Trả về JSON với key "suggested_name".
      `;

      const responseSchema = {
        type: "object",
        properties: {
          suggested_name: { type: "string" },
        },
        required: ["suggested_name"],
      };

      const data = await runGemini(prompt, responseSchema);
      console.log("[ClassifyFileName] AI Result:", data);

      if (!data.suggested_name) {
        throw new Error("AI failed to generate filename");
      }

      // Clean and validate
      const finalName = cleanFileName(data.suggested_name);

      res.status(200).json({
        success: true,
        data: { fileName: finalName },
      });
    } catch (error) {
      console.error("ClassifyFileName Error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }

  /**
   * Classify category based on content
   */
  static async classifyCategory(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File is required",
        });
      }

      // Get file buffer (handle both memory and disk storage)
      let fileBuffer = req.file.buffer;

      // If using disk storage, read file from path
      if (!fileBuffer && req.file.path) {
        const fs = require("fs").promises;
        try {
          fileBuffer = await fs.readFile(req.file.path);
          console.log("[ClassifyCategory] Read file from disk:", req.file.path);
        } catch (readError) {
          console.error(
            "[ClassifyCategory] Failed to read file:",
            readError.message
          );
          return res.status(500).json({
            success: false,
            message: "Failed to read uploaded file",
          });
        }
      }

      if (!fileBuffer) {
        return res.status(400).json({
          success: false,
          message: "File buffer or path is required",
        });
      }

      const fileType = req.body.fileType || req.file.mimetype || "unknown";
      const fileName = req.file.originalname;

      // Get existing categories
      const categories = await Category.find().select("_id name").lean();

      // Extract file content
      let fileContent;
      try {
        fileContent = await extractFileContent(fileBuffer, fileType, 4000);
      } catch (extractError) {
        console.error(
          "[ClassifyCategory] Content extraction failed:",
          extractError.message
        );
        return res.status(400).json({
          success: false,
          message: `Cannot process file: ${extractError.message}`,
        });
      }

      const categoryMap =
        categories.length > 0
          ? categories.map((c) => ({ id: c._id.toString(), name: c.name }))
          : null;

      // Build prompt based on existing categories
      let prompt;
      const responseSchema = {
        type: "object",
        properties: {
          action: { type: "string", enum: ["SELECT", "CREATE"] },
          target_id: { type: "string" },
          new_category_name: { type: "string" },
        },
        required: ["action"],
      };

      if (categoryMap?.length > 0) {
        prompt = `
Bạn là trợ lý phân loại tài liệu thông minh.

Tài liệu:
- Tên: "${fileName}"
- Nội dung (preview): "${fileContent.substring(
          0,
          FILE_CONFIG.CATEGORY_PREVIEW_SIZE
        )}"

Danh sách danh mục hiện có:
${JSON.stringify(categoryMap, null, 2)}

Nhiệm vụ:
1. Phân tích nội dung file để hiểu chủ đề chính.
2. Tìm danh mục phù hợp nhất trong danh sách trên dựa vào chủ đề file.
3. Nếu KHÔNG có danh mục nào phù hợp, hãy đề xuất tên danh mục mới ngắn gọn (Tiếng Việt).
4. Ưu tiên chọn danh mục có sẵn hơn là tạo mới để tránh bị rác dữ liệu.

Output JSON:
- action: "SELECT" hoặc "CREATE"
- target_id: ID danh mục nếu SELECT (bắt buộc khi SELECT)
- new_category_name: Tên danh mục mới nếu CREATE (bắt buộc khi CREATE)
        `;
      } else {
        prompt = `
Bạn là trợ lý phân loại tài liệu thông minh.

Tài liệu:
- Tên: "${fileName}"
- Nội dung (preview): "${fileContent.substring(
          0,
          FILE_CONFIG.CATEGORY_PREVIEW_SIZE
        )}"

Hiện tại, chưa có danh mục nào trong hệ thống.

Nhiệm vụ:
1. Phân tích nội dung file để hiểu chủ đề chính.
2. Đề xuất một tên danh mục mới phù hợp với nội dung (ngắn gọn, Tiếng Việt).

Output JSON:
- action: "CREATE"
- new_category_name: Tên danh mục mới
        `;
      }

      const aiResult = await runGemini(prompt, responseSchema);
      console.log("[ClassifyCategory] AI Result:", aiResult);

      let resultCategoryId = null;
      let resultCategoryName = null;
      let isNewCategory = false;

      // Handle SELECT action
      if (aiResult.action === "SELECT" && aiResult.target_id && categoryMap) {
        const exists = categories.find(
          (c) => c._id.toString() === aiResult.target_id
        );
        if (exists) {
          resultCategoryId = exists._id;
          resultCategoryName = exists.name;
          isNewCategory = false;
        }
      }

      // Handle CREATE action or fallback
      if (!resultCategoryId && aiResult.new_category_name) {
        console.log(`[Category] Creating new: ${aiResult.new_category_name}`);
        const newCategory = new Category({
          name: aiResult.new_category_name.trim(),
          description: "Auto-generated by AI",
        });
        await newCategory.save();
        resultCategoryId = newCategory._id;
        resultCategoryName = newCategory.name;
        isNewCategory = true;
      }

      // Final fallback: use first category if available
      if (!resultCategoryId && categories.length > 0) {
        resultCategoryId = categories[0]._id;
        resultCategoryName = categories[0].name;
        isNewCategory = false;
      }

      // If still no category, return error
      if (!resultCategoryId) {
        throw new Error("Unable to determine category");
      }

      res.status(200).json({
        success: true,
        data: {
          categoryId: resultCategoryId,
          categoryName: resultCategoryName,
          isNewCategory,
        },
      });
    } catch (error) {
      console.error("ClassifyCategory Error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }
}

module.exports = DocumentController;
