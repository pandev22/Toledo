/**
 * Pagination helper for Heliactyl Next API
 */

/**
 * Paginate an array of data
 * @param {Array} data - Array of items to paginate
 * @param {number} page - Page number (1-based)
 * @param {number} perPage - Items per page
 * @param {number} maxPerPage - Maximum items per page allowed
 * @returns {Object} Paginated result with metadata
 */
function paginate(data, page = 1, perPage = 20, maxPerPage = 100) {
  // Validate and sanitize inputs
  const currentPage = Math.max(1, parseInt(page) || 1);
  const itemsPerPage = Math.min(
    Math.max(1, parseInt(perPage) || 20),
    maxPerPage
  );

  const total = data.length;
  const totalPages = Math.ceil(total / itemsPerPage);
  
  // Adjust page if it exceeds total pages
  const adjustedPage = Math.min(currentPage, Math.max(1, totalPages));
  
  // Calculate slice indices
  const startIndex = (adjustedPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  
  // Slice the data
  const paginatedData = data.slice(startIndex, endIndex);

  return {
    data: paginatedData,
    pagination: {
      page: adjustedPage,
      perPage: itemsPerPage,
      total: total,
      totalPages: totalPages,
      hasNextPage: adjustedPage < totalPages,
      hasPrevPage: adjustedPage > 1
    }
  };
}

/**
 * Extract pagination parameters from request query
 * @param {Object} query - Express request query object
 * @param {Object} options - Default options
 * @returns {Object} { page, perPage }
 */
function getPaginationParams(query, options = {}) {
  const {
    defaultPage = 1,
    defaultPerPage = 20,
    maxPerPage = 100,
    pageParam = 'page',
    perPageParam = 'per_page'
  } = options;

  const page = Math.max(1, parseInt(query[pageParam]) || defaultPage);
  const perPage = Math.min(
    Math.max(1, parseInt(query[perPageParam]) || defaultPerPage),
    maxPerPage
  );

  return { page, perPage };
}

/**
 * Create pagination middleware for Express
 * @param {Object} options - Pagination options
 * @returns {Function} Express middleware
 */
function createPaginationMiddleware(options = {}) {
  return (req, res, next) => {
    req.pagination = getPaginationParams(req.query, options);
    next();
  };
}

module.exports = {
  paginate,
  getPaginationParams,
  createPaginationMiddleware
};
