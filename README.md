# Arsenal CLI

A command-line interface for Arsenal - Your AI-powered code learning assistant. This CLI works seamlessly with the Arsenal VS Code extension to help you capture, organize, and sync your coding learnings.

## Quick Start

```bash
# Install the CLI globally
npm install -g arsenal-dev

# Initialize Arsenal in your project
arsenal init

# Link to GitHub for automatic syncing (optional)
arsenal link

#Can also unlink 
arsenal unlink

# Manually sync your learnings (or automatically if connected to GitHub repo)
arsenal sync
```

## How Arsenal Works

Arsenal is a complete learning ecosystem that consists of three main components:

### 1. **VS Code Extension** 
- **Log Learnings**: Select code in VS Code and save it with descriptions, function names, and library references
- **Smart Search**: Search through your learnings with AI-powered responses
- **Real-time Integration**: Works directly in your editor without leaving your workflow

### 2. **CLI Tool** (This Repository)
- **Project Setup**: Initialize and configure Arsenal for your project
- **Authentication**: Handle login and API key generation
- **Sync Management**: Upload learnings to the cloud and manage Git hooks
- **Configuration**: Manage project settings and GitHub integration

### 3. **Cloud Dashboard**
- **Web Interface**: View and manage your learnings at [arsenal-dev.com](https://arsenal-dev.com)
- **Advanced Search**: AI-powered search across all your projects