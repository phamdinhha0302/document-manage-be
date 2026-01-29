const generateToken = require('./token-helper.js')

// Vietnamese character mapping for de-accenting
const VIETNAMESE_MAP = {
  // Lowercase vowels with accents
  'à': 'a', 'á': 'a', 'ạ': 'a', 'ả': 'a', 'ã': 'a',
  'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ậ': 'a', 'ẩ': 'a', 'ẫ': 'a',
  'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ặ': 'a', 'ẳ': 'a', 'ẵ': 'a',
  'è': 'e', 'é': 'e', 'ẹ': 'e', 'ẻ': 'e', 'ẽ': 'e',
  'ê': 'e', 'ề': 'e', 'ế': 'e', 'ệ': 'e', 'ể': 'e', 'ễ': 'e',
  'ì': 'i', 'í': 'i', 'ị': 'i', 'ỉ': 'i', 'ĩ': 'i',
  'ò': 'o', 'ó': 'o', 'ọ': 'o', 'ỏ': 'o', 'õ': 'o',
  'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ộ': 'o', 'ổ': 'o', 'ỗ': 'o',
  'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ợ': 'o', 'ở': 'o', 'ỡ': 'o',
  'ù': 'u', 'ú': 'u', 'ụ': 'u', 'ủ': 'u', 'ũ': 'u',
  'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ự': 'u', 'ử': 'u', 'ữ': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỵ': 'y', 'ỷ': 'y', 'ỹ': 'y',
  // Special consonant
  'đ': 'd',
  // Uppercase vowels with accents
  'À': 'A', 'Á': 'A', 'Ạ': 'A', 'Ả': 'A', 'Ã': 'A',
  'Â': 'A', 'Ầ': 'A', 'Ấ': 'A', 'Ậ': 'A', 'Ẩ': 'A', 'Ẫ': 'A',
  'Ă': 'A', 'Ằ': 'A', 'Ắ': 'A', 'Ặ': 'A', 'Ẳ': 'A', 'Ẵ': 'A',
  'È': 'E', 'É': 'E', 'Ẹ': 'E', 'Ẻ': 'E', 'Ẽ': 'E',
  'Ê': 'E', 'Ề': 'E', 'Ế': 'E', 'Ệ': 'E', 'Ể': 'E', 'Ễ': 'E',
  'Ì': 'I', 'Í': 'I', 'Ị': 'I', 'Ỉ': 'I', 'Ĩ': 'I',
  'Ò': 'O', 'Ó': 'O', 'Ọ': 'O', 'Ỏ': 'O', 'Õ': 'O',
  'Ô': 'O', 'Ồ': 'O', 'Ố': 'O', 'Ộ': 'O', 'Ổ': 'O', 'Ỗ': 'O',
  'Ơ': 'O', 'Ờ': 'O', 'Ớ': 'O', 'Ợ': 'O', 'Ở': 'O', 'Ỡ': 'O',
  'Ù': 'U', 'Ú': 'U', 'Ụ': 'U', 'Ủ': 'U', 'Ũ': 'U',
  'Ư': 'U', 'Ừ': 'U', 'Ứ': 'U', 'Ự': 'U', 'Ử': 'U', 'Ữ': 'U',
  'Ỳ': 'Y', 'Ý': 'Y', 'Ỵ': 'Y', 'Ỷ': 'Y', 'Ỹ': 'Y',
  // Special consonant uppercase
  'Đ': 'D'
}

/**
 * Remove Vietnamese accents from text
 * Converts Vietnamese characters to their non-accented equivalents
 * Example: "Kế hoạch triển khai" -> "Ke hoach trien khai"
 * Example: "Đơn xin nghỉ phép" -> "Don xin nghi phep"
 * @param {string} text - Input text with Vietnamese characters
 * @returns {string} - Text with accents removed
 */
function removeVietnameseAccents(text) {
  if (!text || typeof text !== 'string') {
    return ''
  }
  
  // Replace Vietnamese characters using the map
  let result = ''
  for (const char of text) {
    result += VIETNAMESE_MAP[char] || char
  }
  
  // Also normalize any remaining unicode accents (for safety)
  return result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Create a search-friendly version of text
 * Removes accents, converts to lowercase, and normalizes whitespace
 * @param {string} text - Input text
 * @returns {string} - Normalized search text
 */
function normalizeSearchText(text) {
  if (!text || typeof text !== 'string') {
    return ''
  }
  
  return removeVietnameseAccents(text)
    .toLowerCase()
    .replace(/[_\-\.]+/g, ' ') // Replace underscores, hyphens, dots with spaces
    .replace(/\s+/g, ' ')      // Normalize multiple spaces
    .trim()
}

// Utility function to generate URL-friendly slugs
function generateSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[đĐ]/g, 'd')           // Handle Vietnamese Đ
    .replace(/[^a-z0-9\s-]/g, '')    // Remove special characters
    .replace(/\s+/g, '-')            // Replace spaces with hyphens
    .replace(/-+/g, '-')             // Replace multiple hyphens with single
    .trim('-')                       // Remove leading/trailing hyphens
}

module.exports = {
  generateToken,
  generateSlug,
  removeVietnameseAccents,
  normalizeSearchText,
  VIETNAMESE_MAP
}
