const fs = require('fs');
const path = require('path');

function coerceScalar(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

  return trimmed;
}

class SkillRegistry {
  constructor(app) {
    this.app = app || null;
    this.bundledDir = path.join(__dirname, '..', 'skills');
    this.userDir = app ? path.join(app.getPath('userData'), 'skills') : null;
    this.stateFilePath = app ? path.join(app.getPath('userData'), 'skill-state.json') : null;
    this.skills = new Map();
    this.skillState = { skills: {} };
  }

  loadSkills() {
    this.skills.clear();
    this._ensureUserDirectory();
    this.skillState = this._readState();

    this._scanDirectory(this.bundledDir, 'bundled');
    if (this.userDir && fs.existsSync(this.userDir)) {
      this._scanDirectory(this.userDir, 'user');
    }

    this._cleanupState();
    this._writeState();

    console.log(`[SkillRegistry] 已加载 ${this.skills.size} 个技能`);
    return this.skills.size;
  }

  reloadSkills() {
    return this.loadSkills();
  }

  listDetailedSkills() {
    return Array.from(this.skills.values())
      .map((skill) => this._serializeSkill(skill))
      .sort((left, right) => {
        if (left.source !== right.source) {
          return left.source === 'bundled' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
  }

  getEligibleSkills() {
    const eligible = [];
    const currentOS = process.platform;

    for (const skill of this.skills.values()) {
      if (skill.enabled === false) {
        continue;
      }

      const requires = skill.metadata.requires || {};
      if (Array.isArray(requires.os) && requires.os.length > 0 && !requires.os.includes(currentOS)) {
        continue;
      }

      if (Array.isArray(requires.bins) && requires.bins.some((binName) => !this._isBinAvailable(binName))) {
        continue;
      }

      eligible.push({
        name: skill.name,
        description: skill.description,
        dangerous: !!skill.metadata.dangerous,
        confirm: !!skill.metadata.confirm,
        userInvocable: !!skill.userInvocable,
        source: skill.source,
        enabled: true,
        handler: this.getResolvedHandlerName(skill.name)
      });
    }

    return eligible;
  }

  formatForPrompt() {
    const eligible = this.getEligibleSkills();
    if (eligible.length === 0) return '';

    let xml = '<available_skills>\n';
    for (const skill of eligible) {
      const fullSkill = this.skills.get(skill.name);
      xml += '<skill>\n';
      xml += `  <name>${skill.name}</name>\n`;
      xml += `  <description>${skill.description}</description>\n`;
      if (fullSkill?.instructions) {
        xml += `  <instructions>\n${fullSkill.instructions}\n  </instructions>\n`;
      }
      xml += '</skill>\n';
    }
    xml += '</available_skills>';

    return xml;
  }

  buildToolsArray() {
    return this.getEligibleSkills().map((skill) => {
      const fullSkill = this.skills.get(skill.name);
      let parameters = this._extractParameters(fullSkill?.instructions || '');

      if (Object.keys(parameters.properties).length === 0) {
        const resolvedHandlerName = this.getResolvedHandlerName(skill.name);
        if (resolvedHandlerName && resolvedHandlerName !== skill.name) {
          const handlerSkill = this.skills.get(resolvedHandlerName);
          parameters = this._extractParameters(handlerSkill?.instructions || '');
        }
      }

      return {
        type: 'function',
        function: {
          name: skill.name,
          description: skill.description,
          parameters
        }
      };
    });
  }

  getSkill(name) {
    return this.skills.get(name) || null;
  }

  requiresConfirmation(name) {
    const skill = this.skills.get(name);
    return skill ? !!skill.metadata.confirm : false;
  }

  isDangerous(name) {
    const skill = this.skills.get(name);
    return skill ? !!skill.metadata.dangerous : false;
  }

  getResolvedHandlerName(name) {
    let current = String(name || '').trim();
    const seen = new Set();

    while (current && !seen.has(current)) {
      seen.add(current);
      const skill = this.skills.get(current);
      const next = String(skill?.metadata?.handler || '').trim();
      if (!next || next === current) {
        return current;
      }
      current = next;
    }

    return current || String(name || '').trim();
  }

  setSkillEnabled(name, enabled) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能不存在: ${name}`);
    }

    if (!this.skillState.skills[name]) {
      this.skillState.skills[name] = {};
    }
    this.skillState.skills[name].enabled = !!enabled;
    skill.enabled = !!enabled;
    this._writeState();

    return this._serializeSkill(skill);
  }

  getStorageInfo() {
    return {
      bundledDir: this.bundledDir,
      userDir: this.userDir,
      stateFilePath: this.stateFilePath
    };
  }

  createUserSkill(payload = {}) {
    if (!this.userDir) {
      throw new Error('用户技能目录不可用');
    }

    const name = String(payload.name || '').trim();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(name)) {
      throw new Error('技能名称只能包含字母、数字、下划线和短横线，长度 2 到 64');
    }
    if (this.skills.has(name)) {
      throw new Error(`技能已存在: ${name}`);
    }

    const handler = String(payload.handler || '').trim();
    const baseSkill = this.skills.get(handler);
    if (!baseSkill) {
      throw new Error(`基础技能不存在: ${handler}`);
    }

    const description = String(payload.description || '').trim() || `基于 ${handler} 的自定义技能`;
    const whenToUse = String(payload.whenToUse || '').trim()
      || `当需要执行“${description}”这类任务时调用。`;
    const notes = String(payload.notes || '').trim();
    const enabled = payload.enabled !== false;
    const userInvocable = !!payload.userInvocable;

    const metadata = {
      ...(baseSkill.metadata || {}),
      handler,
      dangerous: Object.prototype.hasOwnProperty.call(payload, 'dangerous')
        ? !!payload.dangerous
        : !!baseSkill.metadata.dangerous,
      confirm: Object.prototype.hasOwnProperty.call(payload, 'confirm')
        ? !!payload.confirm
        : !!baseSkill.metadata.confirm,
      category: String(payload.category || '').trim() || baseSkill.metadata.category || 'custom'
    };

    const markdown = this._buildSkillMarkdown({
      name,
      description,
      metadata,
      userInvocable,
      instructions: this._buildDerivedInstructions({
        handler,
        whenToUse,
        notes,
        baseInstructions: baseSkill.instructions || ''
      })
    });

    const directory = path.join(this.userDir, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), markdown, 'utf8');

    if (!this.skillState.skills[name]) {
      this.skillState.skills[name] = {};
    }
    this.skillState.skills[name].enabled = enabled;
    this._writeState();
    this.loadSkills();

    return this.getSkill(name);
  }

  removeSkill(name) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能不存在: ${name}`);
    }
    if (skill.source !== 'user') {
      throw new Error('内置技能不可删除，只能停用');
    }

    fs.rmSync(skill.directory, { recursive: true, force: true });
    delete this.skillState.skills[name];
    this._writeState();
    this.loadSkills();

    return true;
  }

  getSkillDocument(name) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能不存在: ${name}`);
    }

    return {
      name: skill.name,
      source: skill.source,
      filePath: skill.filePath,
      content: fs.readFileSync(skill.filePath, 'utf8')
    };
  }

  saveUserSkillDocument(name, content) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能不存在: ${name}`);
    }
    if (skill.source !== 'user') {
      throw new Error('只有用户技能支持编辑');
    }

    const nextContent = String(content || '');
    const parsed = this._parseSkillContent(nextContent, skill.filePath);
    if (!parsed) {
      throw new Error('技能文档格式无效');
    }
    if (parsed.name !== name) {
      throw new Error('暂不支持通过编辑器修改技能名称');
    }

    fs.writeFileSync(skill.filePath, nextContent, 'utf8');
    this.loadSkills();
    return this.getSkill(name);
  }

  _scanDirectory(directoryPath, source) {
    if (!directoryPath || !fs.existsSync(directoryPath)) {
      return;
    }

    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFilePath = path.join(directoryPath, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFilePath)) continue;

      try {
        const parsed = this._parseSkillMd(skillFilePath);
        if (!parsed) continue;

        parsed.source = source;
        parsed.directory = path.join(directoryPath, entry.name);
        parsed.enabled = this._isSkillEnabled(parsed.name);
        this.skills.set(parsed.name, parsed);
        console.log(`[SkillRegistry] 已加载技能: ${parsed.name} (${source})`);
      } catch (error) {
        console.error(`[SkillRegistry] 解析失败: ${skillFilePath}`, error.message);
      }
    }
  }

  _parseSkillMd(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return this._parseSkillContent(content, filePath);
  }

  _parseSkillContent(content, filePath = '') {
    const frontmatterMatch = String(content || '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!frontmatterMatch) {
      if (filePath) {
        console.warn(`[SkillRegistry] 缺少 YAML frontmatter: ${filePath}`);
      }
      return null;
    }

    const frontmatter = this._parseSimpleYaml(frontmatterMatch[1]);
    const metadata = this._parseMetadata(frontmatter.metadata);
    const name = String(frontmatter.name || '').trim();
    if (!name) {
      if (filePath) {
        console.warn(`[SkillRegistry] 缺少 name 字段: ${filePath}`);
      }
      return null;
    }

    return {
      name,
      description: String(frontmatter.description || '').trim(),
      metadata,
      userInvocable: frontmatter['user-invocable'] === true,
      instructions: String(content).slice(frontmatterMatch[0].length).trim(),
      filePath
    };
  }

  _parseSimpleYaml(yamlText) {
    const result = {};
    const lines = String(yamlText || '').split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (!match) continue;

      const key = match[1].trim();
      const rawValue = match[2].trim();
      result[key] = coerceScalar(rawValue);
    }

    return result;
  }

  _parseMetadata(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;

    const raw = String(value).trim();
    if (!raw) return {};

    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn('[SkillRegistry] metadata JSON 解析失败:', error.message);
      }
    }

    return {};
  }

  _extractParameters(instructions) {
    const properties = {};
    const required = [];
    const text = String(instructions || '');
    const regex = /^-\s+(\w+)\s*\(([^)]+)\)\s*[:：]\s*(.+)$/gm;
    let match = null;

    while ((match = regex.exec(text)) !== null) {
      const paramName = match[1];
      const typeInfo = match[2];
      const description = match[3].trim();
      const parts = typeInfo.split(',').map((item) => item.trim());

      let type = 'string';
      let isRequired = false;
      for (const part of parts) {
        if (['string', 'number', 'boolean', 'integer', 'array', 'object'].includes(part)) {
          type = part;
        }
        if (part === '必须' || part === 'required') {
          isRequired = true;
        }
      }

      const property = { type, description };
      const defaultMatch = description.match(/默认\s*([^，。；;]+)/);
      if (defaultMatch) {
        property.default = coerceScalar(defaultMatch[1]);
      }

      properties[paramName] = property;
      if (isRequired) {
        required.push(paramName);
      }
    }

    return {
      type: 'object',
      properties,
      required
    };
  }

  _isBinAvailable(binName) {
    const { execSync } = require('child_process');
    try {
      const command = process.platform === 'win32' ? `where ${binName}` : `which ${binName}`;
      execSync(command, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  _serializeSkill(skill) {
    return {
      name: skill.name,
      description: skill.description,
      source: skill.source,
      enabled: skill.enabled !== false,
      userInvocable: !!skill.userInvocable,
      dangerous: !!skill.metadata.dangerous,
      confirm: !!skill.metadata.confirm,
      category: skill.metadata.category || 'default',
      handler: this.getResolvedHandlerName(skill.name),
      rawHandler: String(skill.metadata.handler || '').trim() || skill.name,
      filePath: skill.filePath,
      directory: skill.directory,
      removable: skill.source === 'user'
    };
  }

  _ensureUserDirectory() {
    if (!this.userDir) return;
    fs.mkdirSync(this.userDir, { recursive: true });
  }

  _readState() {
    if (!this.stateFilePath || !fs.existsSync(this.stateFilePath)) {
      return { skills: {} };
    }

    try {
      const content = fs.readFileSync(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {}
        };
      }
    } catch (error) {
      console.warn('[SkillRegistry] 读取技能状态失败:', error.message);
    }

    return { skills: {} };
  }

  _writeState() {
    if (!this.stateFilePath) return;

    const normalized = { skills: {} };
    for (const [name, state] of Object.entries(this.skillState.skills || {})) {
      normalized.skills[name] = {
        enabled: state?.enabled !== false
      };
    }

    fs.writeFileSync(this.stateFilePath, JSON.stringify(normalized, null, 2), 'utf8');
  }

  _isSkillEnabled(name) {
    const state = this.skillState.skills?.[name];
    if (!state || typeof state !== 'object') {
      return true;
    }
    return state.enabled !== false;
  }

  _cleanupState() {
    const existingNames = new Set(this.skills.keys());
    for (const name of Object.keys(this.skillState.skills || {})) {
      if (!existingNames.has(name)) {
        delete this.skillState.skills[name];
      }
    }
  }

  _buildSkillMarkdown({ name, description, metadata, userInvocable, instructions }) {
    return [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `metadata: ${JSON.stringify(metadata)}`,
      `user-invocable: ${userInvocable ? 'true' : 'false'}`,
      '---',
      String(instructions || '').trim(),
      ''
    ].join('\n');
  }

  _buildDerivedInstructions({ handler, whenToUse, notes, baseInstructions }) {
    const sections = [
      '## 何时调用',
      whenToUse,
      '',
      '## 执行映射',
      `- 该技能复用内部执行器 \`${handler}\`。`,
      '- 参数结构与基础技能保持兼容。',
      ''
    ];

    if (notes) {
      sections.push('## 额外说明');
      sections.push(notes);
      sections.push('');
    }

    sections.push('## 基础技能说明');
    sections.push(String(baseInstructions || '').trim() || '暂无基础技能说明。');
    sections.push('');

    return sections.join('\n');
  }
}

module.exports = SkillRegistry;
