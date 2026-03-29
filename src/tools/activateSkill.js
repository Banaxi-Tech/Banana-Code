import { getAvailableSkills } from '../utils/skills.js';

export async function activateSkill({ skillName }) {
    const skills = getAvailableSkills();
    // Match by ID or Name
    const skill = skills.find(s => s.id === skillName || s.name === skillName);
    
    if (!skill) {
        return `Error: Skill '${skillName}' not found. Available skills: ${skills.map(s => s.name).join(', ')}`;
    }
    
    // The format expected by the AI agent
    let output = `<activated_skill>\n`;
    output += `<instructions>\n${skill.instructions}\n</instructions>\n`;
    output += `<available_resources>\n`;
    output += `- location: ${skill.path}\n`;
    output += `  (Use list_directory and read_file to access bundled scripts, references, or assets)\n`;
    output += `</available_resources>\n`;
    output += `</activated_skill>`;
    
    return output;
}
