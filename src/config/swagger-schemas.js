/**
 * @swagger
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           description: Error message
 *         status:
 *           type: string
 *           description: Error status
 *         statusCode:
 *           type: number
 *           description: HTTP status code
 *       example:
 *         message: "Internal server error"
 *         status: "error"
 *         statusCode: 500
 * 
 *     Success:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *           description: Success message
 *         status:
 *           type: string
 *           description: Success status
 *         data:
 *           type: object
 *           description: Response data
 *       example:
 *         message: "Operation successful"
 *         status: "success"
 *         data: {}
 */

// Add your Swagger schema definitions here
