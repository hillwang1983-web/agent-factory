import { ProjectProfileSummary } from '../domain/project';

export class ProjectProfileParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectProfileParseError';
  }
}

function extractCommandsFromLegacy(commandsVal: any, defaultIdPrefix: string): any[] {
  const extracted: any[] = [];
  if (typeof commandsVal === 'string') {
    if (commandsVal.trim()) {
      extracted.push({
        id: defaultIdPrefix,
        command: commandsVal.trim(),
        source: 'package.json'
      });
    }
  } else if (Array.isArray(commandsVal)) {
    commandsVal.forEach((item: any, idx: number) => {
      if (typeof item === 'string' && item.trim()) {
        extracted.push({
          id: `${defaultIdPrefix}_${idx}`,
          command: item.trim(),
          source: 'package.json'
        });
      } else if (item && typeof item === 'object' && 'command' in item) {
        const cmd = item.command;
        if (typeof cmd === 'string' && cmd.trim()) {
          extracted.push({
            id: String(item.id || `${defaultIdPrefix}_${idx}`),
            command: cmd.trim(),
            source: String(item.source || 'package.json')
          });
        }
      }
    });
  } else if (commandsVal && typeof commandsVal === 'object') {
    for (const [key, val] of Object.entries(commandsVal)) {
      if (typeof val === 'string' && val.trim()) {
        extracted.push({
          id: key,
          command: val.trim(),
          source: 'package.json'
        });
      } else if (val && typeof val === 'object' && 'command' in val) {
        const cmd = (val as any).command;
        if (typeof cmd === 'string' && cmd.trim()) {
          extracted.push({
            id: String((val as any).id || key),
            command: cmd.trim(),
            source: String((val as any).source || 'package.json')
          });
        }
      }
    }
  }
  return extracted;
}

export function parseProjectProfileSummary(parsed: unknown): ProjectProfileSummary {
  if (!parsed || typeof parsed !== 'object') {
    throw new ProjectProfileParseError('Profile must be a non-null object');
  }

  const profile = parsed as any;
  const isV2 = profile.schema_version === 2;

  // 1. Project Type
  const projectType = String(profile.project_type || 'unknown');

  // 2. Detected Stack
  let detectedStack: any[] = [];
  const rawStack = profile.detected_stack;
  if (Array.isArray(rawStack)) {
    rawStack.forEach((item: any) => {
      if (typeof item === 'string') {
        detectedStack.push({ language: item, percentage: 100 });
      } else if (item && typeof item === 'object' && 'language' in item) {
        detectedStack.push({
          language: String(item.language),
          percentage: Number(item.percentage ?? 100)
        });
      }
    });
  } else if (!isV2 && profile.stack?.languages) {
    const langs = profile.stack.languages;
    if (Array.isArray(langs)) {
      detectedStack = langs.map((lang: any) => ({
        language: String(lang),
        percentage: Math.round(100 / Math.max(langs.length, 1))
      }));
    }
  } else if (!isV2 && profile.tech_stack) {
    const primary = profile.tech_stack.primary_language;
    const secondary = profile.tech_stack.secondary_languages || [];
    const langs: string[] = [];
    if (primary && typeof primary === 'string') {
      langs.push(primary.split(' ')[0].toLowerCase());
    }
    if (Array.isArray(secondary)) {
      secondary.forEach((s: any) => {
        if (typeof s === 'string') {
          const cleaned = s.toLowerCase();
          if (cleaned === 'node.js') {
            langs.push('javascript');
          } else {
            langs.push(cleaned);
          }
        }
      });
    }
    const uniqueLangs = Array.from(new Set(langs));
    detectedStack = uniqueLangs.map((lang: string) => ({
      language: lang,
      percentage: Math.round(100 / Math.max(uniqueLangs.length, 1))
    }));
    const totalPct = detectedStack.reduce((sum: number, item: any) => sum + item.percentage, 0);
    if (totalPct > 0 && totalPct !== 100 && detectedStack.length > 0) {
      detectedStack[0].percentage += (100 - totalPct);
    }
  }

  // 3. Risk Level
  let riskLevel = 'unknown';
  if (profile.risk_profile && typeof profile.risk_profile === 'object') {
    riskLevel = profile.risk_profile.risk_level || 'unknown';
  } else if (profile.risk_level) {
    riskLevel = profile.risk_level;
  }

  const validRiskLevels = ['low', 'medium', 'high', 'unknown'];
  if (!validRiskLevels.includes(riskLevel)) {
    riskLevel = 'unknown';
  }

  // Legacy risk map derivation if still unknown
  if (riskLevel === 'unknown' && !isV2) {
    if (profile.risk_map?.high_risk_paths && Array.isArray(profile.risk_map.high_risk_paths)) {
      const count = profile.risk_map.high_risk_paths.length;
      riskLevel = count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
    } else if (profile.risks && Array.isArray(profile.risks)) {
      const count = profile.risks.length;
      riskLevel = count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
    }
  }

  // 4. Commands Extraction
  let buildCommandsRaw: any;
  let testCommandsRaw: any;

  if (isV2) {
    const commandsObj = profile.commands || {};
    const safeObj = commandsObj.safe || {};
    buildCommandsRaw = safeObj.build || [];
    testCommandsRaw = safeObj.test || [];
    
    if (!Array.isArray(buildCommandsRaw) || !Array.isArray(testCommandsRaw)) {
      throw new ProjectProfileParseError('V2 profile commands.safe.build/test must be arrays');
    }
  } else {
    const commandsSrc = profile.discovered_commands || profile.commands || {};
    if (commandsSrc && typeof commandsSrc === 'object') {
      const buildLegacy = commandsSrc.build;
      const testLegacy = commandsSrc.test;
      buildCommandsRaw = extractCommandsFromLegacy(buildLegacy, 'build');
      testCommandsRaw = extractCommandsFromLegacy(testLegacy, 'test');
    } else {
      buildCommandsRaw = [];
      testCommandsRaw = [];
    }
  }

  // Extract clean de-duplicated commands
  const buildCommands: string[] = [];
  const seenBuild = new Set<string>();
  buildCommandsRaw.forEach((item: any) => {
    const cmd = isV2 ? item?.command : item?.command;
    if (typeof cmd === 'string' && cmd.trim()) {
      const cleaned = cmd.trim();
      if (!seenBuild.has(cleaned)) {
        seenBuild.add(cleaned);
        buildCommands.push(cleaned);
      }
    } else if (isV2) {
      throw new ProjectProfileParseError('V2 command item must contain a non-empty command string');
    }
  });

  const testCommands: string[] = [];
  const seenTest = new Set<string>();
  testCommandsRaw.forEach((item: any) => {
    const cmd = isV2 ? item?.command : item?.command;
    if (typeof cmd === 'string' && cmd.trim()) {
      const cleaned = cmd.trim();
      if (!seenTest.has(cleaned)) {
        seenTest.add(cleaned);
        testCommands.push(cleaned);
      }
    } else if (isV2) {
      throw new ProjectProfileParseError('V2 command item must contain a non-empty command string');
    }
  });

  return {
    detected_stack: detectedStack,
    project_type: projectType,
    risk_level: riskLevel as any,
    build_commands: buildCommands,
    test_commands: testCommands,
    scan_summary: profile.scan_summary || {},
  };
}
