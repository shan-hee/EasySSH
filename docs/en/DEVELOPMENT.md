# EasySSH Development Guide

<div align="center">
  <img src="../../src/assets/icons/logo.svg" alt="EasySSH Logo" width="50" />
  <h2>🛠️ Development Guide</h2>
  <p>
    <a href="../zh/DEVELOPMENT.md">🇨🇳 中文</a> | 
    <a href="../README.md">📚 Documentation Center</a>
  </p>
</div>

## Project Overview

EasySSH is a modern SSH client that provides efficient, secure, and user-friendly remote server management experience. The project adopts a frontend-backend separation architecture, with the frontend based on Vue.js and the backend based on Node.js Express framework, using SQLite and node-cache for data storage.

## System Requirements

- Node.js >= 20.0.0
- SQLite >= 3.0.0
- Modern browsers support (Chrome, Firefox, Edge, Safari)
- OpenSSH client (optional, for some advanced features)

## Quick Start

Follow these steps to set up and run the project:

### Clone Repository

```bash
git clone https://github.com/shan-hee/EasySSH.git
cd EasySSH
```

### Environment Configuration

1. Copy the environment variables example file:

```bash
cp .env.example .env
```

2. Edit the `.env` file and configure the following important parameters:

- `VITE_PORT`: Frontend dev server port (default 8520)
- `SERVER_PORT`: Backend server port (default 8000)
- `VITE_API_TARGET`: Frontend proxy target (default `http://localhost:8000`)
- `JWT_SECRET`: JWT token secret key for user authentication
- `ENCRYPTION_KEY`: Sensitive data encryption key
- `SQLITE_PATH`: SQLite database path (default `./server/data/easyssh.sqlite`)

### Install Dependencies

```bash
# Install frontend dependencies (recommend pnpm)
pnpm install
# or
npm install

# Install server dependencies
cd server
pnpm install # or npm install
cd ..
```

### Database Preparation

The SQLite database will be automatically created on first startup, no additional configuration required.

### Start Application

```bash
# Start frontend in development mode
pnpm dev

# Start server in another terminal
cd server
pnpm dev
```

## Development Workflow

### Project Structure

```
easyssh/
├── server/               # Backend code
│   ├── config/           # Configuration files
│   ├── controllers/      # API controllers
│   ├── data/             # SQLite database files
│   ├── middleware/       # Middleware
│   ├── models/           # Data models
│   ├── routes/           # API routes
│   ├── services/         # Business logic services
│   └── ssh/              # SSH connection management
├── src/                  # Frontend source code
│   ├── assets/           # Static resources
│   ├── components/       # Vue components
│   ├── store/            # Pinia state management
│   ├── views/            # Page views
│   └── router/           # Route configuration
└── public/               # Public resources
```

### Frontend Development

1. Create new components in the `src/components` directory
2. Assemble pages using `src/views`
3. Define routes in `src/router`
4. Use Pinia stores in `src/store` for state management

### Backend Development

1. Define data models in `server/models`
2. Implement business logic in `server/services`
3. Define API controllers in `server/controllers`
4. Register API routes in `server/routes`

## Troubleshooting

1. **SQLite Connection Failed**
- Check if data directory exists and has write permissions
- Confirm SQLite driver is properly installed

2. **Cache Not Working Properly**
- Check if node-cache configuration is correct
- Confirm cache key-value settings are correct

3. **SSH Connection Issues**
- Confirm SSH credentials are correct
- Check firewall settings
- Try testing connection with telnet: `telnet hostname port`

4. **High Memory Usage**
- Reduce cache TTL
- Optimize query logic to reduce memory usage

## Deployment Guide

### Production Environment Setup

1. Set environment variables:
```
NODE_ENV=production
JWT_SECRET=your_secure_jwt_secret
ENCRYPTION_KEY=your_secure_encryption_key
```

2. Build frontend:
```bash
pnpm build
# or
# npm run build
```

3. Configure reverse proxy (Nginx example):
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:8520;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Docker Deployment

```bash
docker build -t easyssh .
docker run -p 8520:8520 -v sqlite-data:/app/server/data easyssh
```

## 🚀 Usage Guide

### Common Commands

Note: Commands use pnpm; if you prefer npm, replace `pnpm <script>` with `npm run <script>`.

```bash
# Development environment
pnpm dev                       # Start development server
pnpm dev:debug                 # Start in debug mode

# Build related
pnpm build                    # Production build
pnpm build:report             # Build analysis
pnpm build:optimize           # Optimize build process
pnpm preview                  # Preview build results

# Code quality
pnpm lint                     # Code linting
pnpm lint:fix                 # Auto fix
pnpm format                   # Code formatting
pnpm format:check             # Format check

# Dependency management
pnpm deps:check               # Check outdated dependencies
pnpm deps:update              # Update dependencies
pnpm deps:manage              # Dependency management tool
pnpm deps:sync                # Sync frontend/backend dependencies

# Cleanup related
pnpm clean                    # Clean cache
pnpm clean:all                # Complete cleanup
pnpm reinstall                # Reinstall
```

### Server Commands

Note: Commands use pnpm; if you prefer npm, replace `pnpm <script>` with `npm run <script>`.

```bash
cd server

# Development environment
pnpm dev                      # Development mode
pnpm dev:debug                # Debug mode
pnpm prod                     # Production mode

# Database management
pnpm db:backup                # Backup database
pnpm db:restore               # Restore database

# Code quality
pnpm lint                     # Code linting
pnpm lint:fix                 # Auto fix
```

## 📊 Performance Monitoring

### Build Analysis
- Run `pnpm build:report` to view package analysis
- Check generated analysis reports for package size distribution
- Review build information for performance optimization

### Bundle Size Monitoring
- Run `pnpm size` to check bundle size
- Configuration in `package.json` `bundlesize` field
- Automatically check if threshold is exceeded

### Dependency Analysis
- Run `pnpm deps:manage` to check dependency status
- Automatically detect version inconsistency issues
- Generate dependency reports

## 🔧 Configuration Files

### Environment Configuration
- `.env.example` - Configuration template
- `.env` - Actual environment variables (copied from template)

### Build Configuration
- `vite.config.js` - Main build configuration (includes performance optimization and analysis features)

### Code Quality
- `.eslintrc.cjs` - ESLint rules
- `.prettierrc` - Prettier configuration
- `server/.eslintrc.cjs` - Server-side ESLint

## 🎯 Best Practices

### Development Workflow
1. Use `pnpm dev` to start development server
2. Regularly run `pnpm lint:fix` to fix code issues
3. Run `pnpm format` before committing to format code
4. Use `pnpm test` (if configured) to ensure tests pass

### Build Workflow
1. Run `pnpm build:optimize` for optimized build
2. Use `pnpm build:report` to analyze bundle size
3. Check `pnpm size` to ensure reasonable bundle size
4. Run `pnpm preview` to preview build results

### Dependency Management
1. Regularly run `pnpm deps:check` to check for updates
2. Use `pnpm deps:manage` to manage dependency versions
3. Backup database before important updates `pnpm db:backup`

## Technology Stack

- Frontend: Vue 3, Pinia, Vue Router, Element Plus
- Backend: Node.js, Express, SQLite, node-cache
- SSH Connection: ssh2, xterm.js
- Encryption: bcryptjs, crypto-js, jsonwebtoken

## Contributing Guidelines

1. Fork the project repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the remote branch (`git push origin feature/amazing-feature`)
5. Submit a Pull Request

## Open Source License

This project is open-sourced under the Apache License 2.0. For details, please refer to the [LICENSE](../../LICENSE) file.
