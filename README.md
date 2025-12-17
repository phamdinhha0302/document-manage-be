# New Project API

A clean Node.js Express API starter project with MongoDB.

## 🚀 Features

- Express.js server
- MongoDB with Mongoose
- File upload support with Multer
- CORS enabled
- Helmet security
- Compression
- Docker support
- Hot reload with Nodemon

## 📁 Project Structure

```
rig-landing-be/
├── src/
│   ├── api/
│   │   ├── controllers/     # Add your controllers here
│   │   ├── middlewares/     # Add your middleware here
│   │   └── routes/          # API routes
│   ├── config/              # Configuration files
│   ├── loaders/             # App initialization
│   ├── schemas/             # Mongoose schemas
│   └── utils/               # Utility functions
├── uploads/                 # Uploaded files
├── docker/                  # Docker configuration
├── .env                     # Environment variables
├── docker-compose.yml       # Docker compose configuration
└── package.json            # Dependencies

```

## 🛠️ Setup

### Prerequisites
- Node.js >= 14
- MongoDB
- Docker (optional)

### Installation

1. Install dependencies:
```bash
pnpm install
# or
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the server:
```bash
# Development mode
pnpm dev
# or
npm run dev

# Production mode
pnpm start
# or
npm start
```

### Using Docker

```bash
# Build and start containers
pnpm run docker:up
# or
npm run docker:up

# View logs
pnpm run docker:logs
# or
npm run docker:logs

# Stop containers
pnpm run docker:down
# or
npm run docker:down
```

## 📝 API Documentation

Once the server is running, visit:
- Health Check: `http://localhost:3000/api/v1/health`

## 🔧 Development

### Adding a New Feature

1. **Create Schema** (`src/schemas/yourmodel.js`):
```javascript
import mongoose from 'mongoose';

const YourModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  // Add more fields
}, { timestamps: true });

export default mongoose.model('YourModel', YourModelSchema);
```

2. **Export Schema** (`src/schemas/index.js`):
```javascript
import YourModelSchema from './yourmodel.js';
export const YourModel = YourModelSchema;
```

3. **Create Controller** (`src/api/controllers/yourmodel.js`):
```javascript
import { YourModel } from '../../schemas/index.js';

export const getAll = async (req, res) => {
  try {
    const items = await YourModel.find();
    res.json({ status: 'success', data: items });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
```

4. **Create Routes** (`src/api/routes/yourmodel.js`):
```javascript
import { Router } from 'express';
import * as controller from '../controllers/yourmodel.js';

const router = Router();

router.get('/', controller.getAll);

export default router;
```

5. **Register Routes** (`src/api/routes/index.js`):
```javascript
import yourModelRoutes from './yourmodel.js';
router.use('/your-model', yourModelRoutes);
```

## 📦 Scripts

- `pnpm dev` - Start development server with hot reload
- `pnpm start` - Start production server
- `pnpm run docker:build` - Build Docker images
- `pnpm run docker:up` - Start Docker containers
- `pnpm run docker:down` - Stop Docker containers
- `pnpm run docker:logs` - View Docker logs
- `pnpm run docker:clean` - Clean Docker resources

## 🔐 Environment Variables

Create a `.env` file in the root directory:

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/your-database
API_PREFIX=/api/v1
JWT_SECRET=your-secret-key
```

## 📄 License

MIT

## 👤 Author

Your Name
