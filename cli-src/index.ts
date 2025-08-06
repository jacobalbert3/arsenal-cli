#!/usr/bin/env node

// CLI Tools
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import type { RequestInfo, RequestInit } from 'node-fetch';

//for localhost:
// const API_URL = http://127.0.0.1:8000';
const API_URL = 'https://arsenal-backend-production.up.railway.app';


const fetch = async (url: RequestInfo, init?: RequestInit) => {
  const mod = await import('node-fetch');
  return mod.default(url, init);
};

type LoginResponse = {
  access_token: string
  user_id: number
  token_type: string
  detail?: string
}

type ApiKeyResponse = {
  api_key: string
}

type TestApiKeyResponse = {
  user: {
    user_id: number;
    project_id: number;
  }
}

// Function to generate API key
const generateApiKey = async (accessToken: string, projectId: number): Promise<string> => {
  const res = await fetch(`${API_URL}/auth/generate-key`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ project_id: parseInt(projectId.toString()) })
  });

  if (!res.ok) {
    const error = await res.json() as { detail?: string };
    throw new Error(error.detail || 'Failed to generate API key');
  }

  const data = await res.json() as ApiKeyResponse;
  return data.api_key;
};

const validateConfig = async (config: any): Promise<void> => {
  try {
    const res = await fetch(`${API_URL}/auth/test-api-key`, {
      headers: { 'Authorization': `ApiKey ${config.apiKey}` }
    });
    
    if (!res.ok) {
      throw new Error('Invalid API key');
    }

    const data = await res.json() as TestApiKeyResponse;
    
    if (data.user.user_id !== config.userId || data.user.project_id !== parseInt(config.projectId)) {
      throw new Error('Config mismatch: API key does not match user ID or project ID');
    }
  } catch (err: any) {
    throw new Error(`Configuration validation failed: ${err.message}`);
  }
};

const program = new Command();

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
program
  .name('arsenal')
  .description('CLI for Arsenal learning assistant')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Arsenal project')
  .action(async () => {
    const configDir = path.join(process.cwd(), '.arsenal');
    const configFile = path.join(configDir, 'config.json');
  
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir);
    }
  
    // Prompt user
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Enter your Arsenal login email:',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Enter your Arsenal password:',
        mask: '*'
      },
      {
        type: 'input',
        name: 'projectId',
        message: 'Enter your Arsenal project ID (from arsenal.com)'
      }
    ]);

    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: answers.email, password: answers.password }),
    });
    const loginData = (await loginRes.json()) as LoginResponse
    
    if (!loginRes.ok) {
      console.log(chalk.red(`❌ Login failed: ${loginData.detail}`));
      return;
    }

    // First verify project ownership using JWT token
    const projectCheckRes = await fetch(`${API_URL}/projects/${answers.projectId}`, {
      headers: { Authorization: `Bearer ${loginData.access_token}` }
    });
  
    if (!projectCheckRes.ok) {
      console.log(chalk.red(`❌ Project ${answers.projectId} not found or not owned by you.`));
      return;
    }

    // After verifying ownership, generate API key for future operations
    let apiKey: string;
    try {
      apiKey = await generateApiKey(loginData.access_token, parseInt(answers.projectId));
      console.log(chalk.green('✅ Generated API key'));
    } catch (err) {
      console.log(chalk.red('❌ Failed to generate API key'));
      return;
    }

    const config = {
      projectId: answers.projectId,
      apiKey: apiKey,
      userId: loginData.user_id
    };
    
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(chalk.green('✅ Project initialized with API key'));
  });
  
  program
  .command('sync')
  .description('Sync local learnings to the cloud')
  .action(async () => {
    const configPath = path.join(process.cwd(), '.arsenal', 'config.json');
    const learningsDir = path.join(process.cwd(), '.arsenal', 'learnings');

    if (!fs.existsSync(configPath)) {
      console.error(chalk.red('❌ No config found. Did you run `arsenal init`?'));
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    try {
      await validateConfig(config);
    } catch (err: any) {
      console.error(chalk.red(`❌ ${err.message}`));
      return;
    }

    console.log(chalk.blue(`🔗 Project ID: ${config.projectId}`));
    console.log(chalk.blue(`🔗 GitHub Repo: ${config.githubRepo}`));

    // Step 2: Read learning files
    if (!fs.existsSync(learningsDir)) {
      console.warn('⚠️ No learnings directory found.');
      return;
    }

    const files = fs.readdirSync(learningsDir).filter(file => file.endsWith('.json'));

    if (files.length === 0) {
      console.log('📭 No learnings to sync.');
      return;
    }

    console.log(chalk.yellow(`📤 Syncing ${files.length} learning(s)...`));

    const sendLearning = async (learning: any, config: any, filePath: string) => {
      try {
        const res = await fetch(`${API_URL}/projects/${config.projectId}/learnings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `ApiKey ${config.apiKey}`  // Use API key here
          },
          body: JSON.stringify({
            file_path: learning.file_path,
            function_name: learning.function_name,
            library_name: learning.library_name,
            description: learning.description,
            code_snippet: learning.code_snippet,
          })
        });
      
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        fs.unlinkSync(filePath);
      } catch (err: any) {
        throw new Error(`Failed to sync ${learning.title}: ${err.message}`);
      }
    };
      
    // Loop over each file
    const syncAll = async () => {
      try {
        for (const file of files) {
          const filePath = path.join(learningsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const learning = JSON.parse(content);
          await sendLearning(learning, config, filePath);
        }
        console.log(chalk.green(`✅ Successfully synced ${files.length} learning(s)`));
      } catch (err: any) {
        console.log(chalk.red(`❌ ${err.message}`));
      }
    };

    await syncAll();
  });

program
  .command('link')
  .description('Link Arsenal to git hooks for automatic syncing')
  .action(async () => {
    if (!isGitRepo()) {
      console.log(chalk.red('❌ This folder is not a Git repo. Please run `git init` or clone a repo first.'));
      return;
    }

    const configPath = path.join(process.cwd(), '.arsenal', 'config.json');
    if (!fs.existsSync(configPath)) {
      console.log(chalk.red('❌ No Arsenal config found. Please run `arsenal init` first.'));
      return;
    }

    // Try to detect GitHub repo
    let defaultRepo = '';
    try {
      defaultRepo = execSync('git config --get remote.origin.url').toString().trim();
    } catch (err) {
      console.warn('⚠️ Could not auto-detect GitHub repo.');
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'githubRepo',
        message: 'What is the GitHub repo URL for this project?',
        default: defaultRepo || 'https://github.com/username/repo'
      }
    ]);

    // Update config with GitHub repo
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.githubRepo = answers.githubRepo;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const hookPath = path.join(process.cwd(), '.git', 'hooks', 'pre-push');
    const hookScript = `#!/bin/bash
echo "🔁 Running arsenal sync after Git push..."
arsenal sync
`;
    try {
      fs.writeFileSync(hookPath, hookScript, { mode: 0o755 }); // writes + makes it executable
      console.log(chalk.green('✅ Git hook installed at .git/hooks/pre-push'));
      console.log(chalk.green('✅ GitHub repo linked successfully'));
    } catch (err: any) {
      console.log(chalk.red('❌ Failed to install Git hook:'), err.message);
    }
  });

program
  .command('unlink')
  .description('Remove Arsenal git hooks')
  .action(() => {
    const hookPath = path.join(process.cwd(), '.git', 'hooks', 'pre-push');
    
    try {
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
        console.log(chalk.green('✅ Git hook removed successfully'));
      } else {
        console.log(chalk.yellow('⚠️ No Arsenal git hook found'));
      }
    } catch (err: any) {
      console.log(chalk.red('❌ Failed to remove Git hook:'), err.message);
    }
  });

program.parse();
