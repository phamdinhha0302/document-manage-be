const { User } = require('../../schemas/index.js')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

class AuthController {
    static async register(req, res) {
        try {
            const { email, password, fullName } = req.body

            // Validate input
            if (!email || !password || !fullName) {
                return res.status(400).json({
                    success: false,
                    message: 'Email, password, and fullName are required',
                })
            }

            // Check if user exists
            const existingUser = await User.findOne({ email })
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already registered',
                })
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10)

            // Create user
            const user = new User({
                email,
                password: hashedPassword,
                fullName,
            })

            await user.save()

            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                data: {
                    id: user._id,
                    email: user.email,
                    fullName: user.fullName,
                },
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    static async login(req, res) {
        try {
            const { email, password } = req.body

            // Validate input
            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Email and password are required',
                })
            }

            // Find user
            const user = await User.findOne({ email })
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                })
            }

            // Check password
            const isPasswordValid = await bcrypt.compare(password, user.password)
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                })
            }

            // Generate token
            const token = jwt.sign(
                { userId: user._id, email: user.email, role: user.role },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '7d' }
            )

            res.status(200).json({
                success: true,
                message: 'Login successful',
                data: {
                    token,
                    user: {
                        id: user._id,
                        email: user.email,
                        fullName: user.fullName,
                        role: user.role,
                    },
                },
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    static async getProfile(req, res) {
        try {
            const user = await User.findById(req.user.userId).select('-password')
            res.status(200).json({
                success: true,
                data: user,
            })
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }
}

module.exports = AuthController
