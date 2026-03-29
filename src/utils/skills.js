import fs from 'fs';
import path from 'path';
import os from 'os';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'banana-code', 'skills');

/**
 * Scans the skills directory and parses SKILL.md files.
 * @returns {Array} List of discovered skills.
 */
export function getAvailableSkills() {
    try {
        if (!fs.existsSync(SKILLS_DIR)) {
            fs.mkdirSync(SKILLS_DIR, { recursive: true });
        }
    } catch (e) {
        return [];
    }

    let skills = [];
    try {
        const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skillPath = path.join(SKILLS_DIR, entry.name);
                const mdPath = path.join(skillPath, 'SKILL.md');
                
                if (fs.existsSync(mdPath)) {
                    try {
                        const content = fs.readFileSync(mdPath, 'utf8');
                        // Match YAML frontmatter between --- and ---
                        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
                        
                        if (match) {
                            const frontmatter = match[1];
                            const body = content.slice(match[0].length).trim();
                            
                            // Simple YAML parsing via regex
                            const nameMatch = frontmatter.match(/name:\s*['"]?([^'"\n]+)['"]?/);
                            const descMatch = frontmatter.match(/description:\s*['"]?([^'"\n]+)['"]?/);
                            
                            if (nameMatch && descMatch) {
                                skills.push({
                                    id: entry.name,
                                    name: nameMatch[1].trim(),
                                    description: descMatch[1].trim(),
                                    instructions: body,
                                    path: skillPath
                                });
                            }
                        }
                    } catch (err) {
                        // Skip corrupted or unreadable skills
                    }
                }
            }
        }
    } catch (e) {}
    
    return skills;
}
