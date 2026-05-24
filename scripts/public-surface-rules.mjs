export const PRIVATE_KEYS = new Set([
  "accessMode",
  "adapter",
  "apiUrl",
  "coverageNote",
  "crawler",
  "crawlerReport",
  "crawledAt",
  "debug",
  "debugReport",
  "deadlineTimezone",
  "developerNote",
  "developerComment",
  "developerRemark",
  "devNote",
  "devComment",
  "devRemark",
  "debugNote",
  "debugComment",
  "debugRemark",
  "error",
  "forecastBasis",
  "internalNote",
  "internalComment",
  "internalRemark",
  "lastChecked",
  "licenseNote",
  "linkCheckMode",
  "maintainerNote",
  "maintainerComment",
  "maintainerRemark",
  "parser",
  "parserConfidence",
  "privateNote",
  "privateComment",
  "privateRemark",
  "raw",
  "rawHtml",
  "rawPayload",
  "rawSource",
  "releaseCadence",
  "sampleNote",
  "scopeNote",
  "sourcePolicy",
  "sourcePriority",
  "validationNote"
]);

export const PRIVATE_KEY_PATTERNS = [
  /^(?:internal|private|debug|crawler|crawl|parser|adapter|raw|error)[A-Za-z0-9_]*$/i,
  /(?:developer|dev|maintainer|internal|private|debug|crawler|crawl|parser|adapter|license|coverage|sample|scope|linkCheck|validation|raw|error)[A-Za-z0-9_]*(?:Note|Notes|Comment|Comments|Memo|Memos|Remark|Remarks|Annotation|Annotations|Report|Reports|Message|Messages)$/i,
  /^(?:raw|error|stack|trace|exception)$/i,
  /(?:开发者|开发人员|开发|内部|内测|维护者?|维护人|运营|调试|私有|私人|爬虫|解析器|原始|错误).{0,16}(?:备注|说明|注释|留言|消息|报告|记录)$/i
];

export const FORBIDDEN_TEXT_PATTERNS = [
  /\b(?:developerNote|developerComment|developerRemark|devNote|devComment|devRemark|debugNote|debugComment|debugRemark|internalNote|internalComment|internalRemark|privateNote|privateComment|privateRemark|maintainerNote|maintainerComment|maintainerRemark|forecastBasis|releaseCadence|accessMode|apiUrl|licenseNote|scopeNote|linkCheckMode|parserConfidence|sourcePolicy|sourcePriority|validationNote|crawlerReport|debugReport|rawHtml|rawPayload|rawSource)\b/,
  /developer note/i,
  /developer remark/i,
  /maintainer note/i,
  /maintainer remark/i,
  /internal note/i,
  /internal remark/i,
  /private note/i,
  /private remark/i,
  /debug note/i,
  /debug remark/i,
  /not for public/i,
  /do not publish/i,
  /开发者[的把]?备注/,
  /开发者.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /开发人员.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /开发备注/,
  /内部[的把]?备注/,
  /内部.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /维护(?:者)?[的把]?备注/,
  /维护(?:者|人)?.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /调试[的把]?备注/,
  /调试.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /私有[的把]?备注/,
  /私有.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /私人[的把]?备注/,
  /私人.{0,16}(?:备注|注释|留言|消息|报告|记录)/,
  /\b(?:TODO|FIXME|HACK|XXX):/i
];

export function isPrivateKey(key) {
  return PRIVATE_KEYS.has(key) || PRIVATE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function publicSourceLabel(accessMode) {
  if (accessMode === "public") return "公开来源";
  if (accessMode === "manual_verified") return "人工核验来源";
  if (accessMode === "licensed_import") return "授权导入来源";
  if (accessMode === "login_required") return "需登录核验来源";
  return "来源";
}

export function stripPrivateFields(value) {
  if (Array.isArray(value)) return value.map(stripPrivateFields);
  if (!value || typeof value !== "object") return value;

  const result = {};
  if ("accessMode" in value) {
    result.sourceLabel = publicSourceLabel(value.accessMode);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (isPrivateKey(key)) continue;
    result[key] = stripPrivateFields(nested);
  }
  return result;
}

export function scanPublicPayload(value, label = "payload") {
  const errors = [];

  function visit(node, path) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") {
      if (typeof node === "string") {
        for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
          if (pattern.test(node)) errors.push(`${path}: contains private text "${node}"`);
        }
      }
      return;
    }
    for (const [key, nested] of Object.entries(node)) {
      if (isPrivateKey(key)) errors.push(`${path}.${key}: private key must not be public`);
      visit(nested, `${path}.${key}`);
    }
  }

  visit(value, label);
  return errors;
}

