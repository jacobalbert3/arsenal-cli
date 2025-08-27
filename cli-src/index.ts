#!/usr/bin/env node

// CLI Tools

//provides command parsing, error handling, and help messages
import { Command } from 'commander';
//adds color and styling to terminal
import chalk from 'chalk';
//allows async file operations in the CLI
import fs from 'fs/promises';
//handles files and paths in cross platform way
import path from 'path';
//interactive command line prompts for user
import inquirer from 'inquirer';
//executes shell commands from within CLI 
import { execSync } from 'child_process';
//makes request to backend
import fetch from 'node-fetch';

//Current railway URL
const API_URL = 'https://arsenal-backend-production.up.railway.app';

// Type definitions (catch errors at comepile time)
type LoginResponse = {
  access_token: string
  user_id: number
  token_type: string
  detail?: string
}

//expect string from API KEY
type ApiKeyResponse = {
  api_key: string
}

//expect user_id and project_id from API KEY (for validation)
type TestApiKeyResponse = {
  user: {
    user_id: number;
    project_id: number;
  }
}

//type for config file (note - github repo is optional)
type Config = {
  projectId: string;
  apiKey: string;
  userId: number;
  githubRepo?: string;
}

//type for each learning file that will be synced to the cloud
type Learning = {
  file_path: string;
  function_name: string;
  library_name: string;
  description: string;
  code_snippet: string;
  title?: string;
}

//check if the current repository is inside a working directory
function isGitRepo(): boolean {
  try {
    //execSync = execute command asynchronously
    //check if the current repository is inside a working directory
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

//simple email validation - don't rlly care if its a real email just about having username
function validateEmail(email: string): boolean {
  // More comprehensive email validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}


// Function to generate API key
const generateApiKey = async (accessToken: string, projectId: number): Promise<string> => {
  const res = await fetch(`${API_URL}/auth/generate-key`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ project_id: projectId })
  });

  if (!res.ok) {
    const error = await res.json() as { detail?: string };
    throw new Error(error.detail || 'Failed to generate API key');
  }

  const data = await res.json() as ApiKeyResponse;
  return data.api_key;
};

//Goal = prevent any tampering with the API key
const validateConfig = async (config: Config): Promise<void> => {
  try {
    // make sure they didn't change the API key: 
    const res = await fetch(`${API_URL}/auth/test-api-key`, {
      headers: { 'Authorization': `ApiKey ${config.apiKey}` }
    });
    
    if (!res.ok) {
      throw new Error('Invalid API key');
    }

    const data = await res.json() as TestApiKeyResponse;
    
    //prevent any tampering with the API key
    if (data.user.user_id !== config.userId || data.user.project_id !== parseInt(config.projectId)) {
      throw new Error('Config mismatch: API key does not match user ID or project ID');
    }
  } catch (err: any) {
    throw new Error(`Configuration validation failed: ${err.message}`);
  }
};

//initialize the program
const program = new Command();

//set the name, description, and version of the program
program
  .name('arsenal')
  .description('CLI for Arsenal learning assistant')
  .version('0.1.0');

//initialize project
program
  .command('init')
  .description('Initialize Arsenal project')
  .action(async () => {
    try {
      //every project has an arsenal folder with config file
      const configDir = path.join(process.cwd(), '.arsenal');
      const configFile = path.join(configDir, 'config.json');
    
      // Create config directory if it doesn't exist
      try {
        await fs.mkdir(configDir, { recursive: true });
      } catch (err) {
        console.error(chalk.red('Failed to create config directory'));
        return;
      }
    
      // Enter email and password and project ID
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: 'Enter your Arsenal login email:',
          validate: (input: string) => {
            if (!validateEmail(input)) {
              return 'Please enter a valid email address';
            }
            return true;
          }
        },
        {
          type: 'password',
          name: 'password',
          message: 'Enter your Arsenal password:',
          mask: '*',
          validate: (input: string) => {
            if (input.length < 1) {
              return 'Password cannot be empty';
            }
            return true;
          }
        },
        {
          type: 'input',
          name: 'projectId',
          message: 'Enter your Arsenal project ID (from arsenal.com)',
          validate:(input: string) => {
            const parsed = Number(input);
            if (isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
              return 'Please enter a valid numeric project ID';
            }
            return true;
          }
        }
      ]);

      console.log(chalk.blue('🔐 Logging in...'));
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: answers.email, password: answers.password }),
      });
      
      const loginData = (await loginRes.json()) as LoginResponse;
      
      if (!loginRes.ok) {
        console.log(chalk.red(`Login failed: ${loginData.detail}`));
        return;
      }

      console.log(chalk.green('✅ Login successful'));

      // Verify project ownership using JWT token
      console.log(chalk.blue('🔍 Verifying project ownership...'));
      const projectCheckRes = await fetch(`${API_URL}/projects/${answers.projectId}`, {
        headers: { Authorization: `Bearer ${loginData.access_token}` }
      });
    
      if (!projectCheckRes.ok) {
        const errorText = await projectCheckRes.text();
        console.log(chalk.red(`❌ Project ${answers.projectId} not found or not owned by you.`));
        console.log(chalk.gray(`Error details: ${errorText}`));
        return;
      }

      // Generate API key for future operations
      console.log(chalk.blue('🔑 Generating API key...'));
      let apiKey: string;
      try {
        apiKey = await generateApiKey(loginData.access_token, parseInt(answers.projectId));
        console.log(chalk.green('✅ Generated API key'));
      } catch (err: any) {
        console.log(chalk.red(`❌ Failed to generate API key: ${err.message}`));
        return;
      }

      //Type for config file
      const config: Config = {
        projectId: answers.projectId,
        apiKey: apiKey,
        userId: loginData.user_id
      };
      
      await fs.writeFile(configFile, JSON.stringify(config, null, 2));
      console.log(chalk.green('✅ Project initialized with API key'));
    } catch (err: any) {
      console.error(chalk.red(`❌ Initialization failed: ${err.message}`));
    }
  });


//sync the learnings to the cloud
program
  .command('sync')
  .description('Sync local learnings to the cloud')
  .action(async () => {
    try {
      //gets config path and learnings directory
      const configPath = path.join(process.cwd(), '.arsenal', 'config.json');
      const learningsDir = path.join(process.cwd(), '.arsenal', 'learnings');

      // Check if config exists
      let config: Config;
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(configContent);
      } catch (err) {
        console.error(chalk.red('❌ No config found. Did you run `arsenal init`?'));
        return;
      }
      
      // Validate config
      try {
        await validateConfig(config);
      } catch (err: any) {
        console.error(chalk.red(`❌ ${err.message}`));
        return;
      }

      console.log(chalk.blue(`🔗 Project ID: ${config.projectId}`));
      if (config.githubRepo) {
        console.log(chalk.blue(`🔗 GitHub Repo: ${config.githubRepo}`));
      }

      // Check if learnings directory exists
      let learningsExist = true;
      try {
        await fs.access(learningsDir);
      } catch {
        learningsExist = false;
      }

      if (!learningsExist) {
        console.warn(chalk.yellow('⚠️ No learnings directory found.'));
        return;
      }

      // Read learning files (only json files)
      const files = (await fs.readdir(learningsDir)).filter(file => file.endsWith('.json'));

      if (files.length === 0) {
        console.log(chalk.blue('📭 No learnings to sync.'));
        return;
      }

      console.log(chalk.yellow(`📤 Syncing ${files.length} learning(s)...`));


      //send the learning to the cloud
      const sendLearning = async (learning: Learning, config: Config, filePath: string) => {
        try {
          const res = await fetch(`${API_URL}/projects/${config.projectId}/learnings`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `ApiKey ${config.apiKey}`
            },
            body: JSON.stringify({
              file_path: learning.file_path,
              function_name: learning.function_name,
              library_name: learning.library_name,
              description: learning.description,
              code_snippet: learning.code_snippet,
            })
          });
        
          if (!res.ok) {
            const error = await res.json().catch(() => ({})) as { detail?: string };
            throw new Error(`Server error: ${res.status} - ${error.detail || 'Unknown error'}`);
          }
          //delete the file after successful sync**
          await fs.unlink(filePath);
        } catch (err: any) {
          const learningName = learning.title || learning.function_name || 'Unknown learning';
          throw new Error(`Failed to sync ${learningName}: ${err.message}`);
        }
      };
        
      // Sync all files with progress tracking
      let successCount = 0;
      let errorCount = 0;
      
      //sync each file
      for (const file of files) {
        try {
          const filePath = path.join(learningsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          //parse the file as a Learning object
          const learning = JSON.parse(content) as Learning;
          //send the learning to the cloud
          await sendLearning(learning, config, filePath);
          //if successful, increment the success count
          successCount++;
          console.log(chalk.green(`✅ Synced: ${learning.function_name || file}`));
        } catch (err: any) {
          errorCount++;
          console.log(chalk.red(`❌ Failed to sync ${file}: ${err.message}`));
        }
      }

      if (successCount > 0) {
        console.log(chalk.green(`✅ Successfully synced ${successCount} learning(s)`));
      }
      if (errorCount > 0) {
        console.log(chalk.red(`❌ Failed to sync ${errorCount} learning(s)`));
      }
    } catch (err: any) {
      console.error(chalk.red(`❌ Sync failed: ${err.message}`));
    }
  });

//link to github repo for automatic syncing via git hooks
program
  .command('link')
  .description('Link Arsenal to git hooks for automatic syncing')
  .action(async () => {
    try {
      if (!isGitRepo()) {
        console.log(chalk.red('❌ This folder is not a Git repo. Please run `git init` or clone a repo first.'));
        return;
      }

      const configPath = path.join(process.cwd(), '.arsenal', 'config.json');
      let config: Config;
      
      //load the config file:
      try {
        const configContent = await fs.readFile(configPath, 'utf-8');
        config = JSON.parse(configContent);
      } catch (err) {
        console.log(chalk.red('❌ No Arsenal config found. Please run `arsenal init` first.'));
        return;
      }

      // Try to detect GitHub repo
      let defaultRepo = '';
      try {
        defaultRepo = execSync('git config --get remote.origin.url').toString().trim();
      } catch (err) {
        console.warn(chalk.yellow('⚠️ Could not auto-detect GitHub repo.'));
      }

      //allow user to enter github repo url
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'githubRepo',
          message: 'What is the GitHub repo URL for this project?',
          validate: (input: string) => {
            if (!input.trim()) {
              return 'GitHub repo URL is required';
            }
            if (!input.includes('github.com')) {
              return 'Please enter a valid GitHub repository URL';
            }
            return true;
          }
        }
      ]);

      // Update config with GitHub repo
      config.githubRepo = answers.githubRepo;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      //** CREATE GIT HOOK */
      const hookPath = path.join(process.cwd(), '.git', 'hooks', 'pre-push');
      //run sync after git push:
      const hookScript = `#!/bin/bash
              echo "🔁 Running arsenal sync after Git push..."
              arsenal sync
              `;
      
      try {
        //set the permissions to executable
        await fs.writeFile(hookPath, hookScript, { mode: 0o755 });
        console.log(chalk.green('✅ Git hook installed at .git/hooks/pre-push'));
        console.log(chalk.green('✅ GitHub repo linked successfully'));
             } catch (err: any) {
         console.log(chalk.red(`❌ Failed to install Git hook: ${err.message}`));
       }
           } catch (err: unknown) {
        console.error(chalk.red(`❌ Link failed: ${err instanceof Error ? err.message : 'Unknown error'}`));
      }
  });

program
  .command('unlink')
  .description('Remove Arsenal git hooks')
  .action(async () => {
    try {
      const hookPath = path.join(process.cwd(), '.git', 'hooks', 'pre-push');
      
      try {
        //check if the hook exists
        await fs.access(hookPath);
        //remove the hook
        await fs.unlink(hookPath);
        console.log(chalk.green('✅ Git hook removed successfully'));
      } catch {
        console.log(chalk.yellow('⚠️ No Arsenal git hook found'));
      }
    } catch (err: any) {
      console.log(chalk.red(`❌ Failed to remove Git hook: ${err.message}`));
    }
  });

//parse the command line arguments
program.parse();
