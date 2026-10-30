export function semanticWarnings(before: string, after: string): string[] {
  const warnings: string[] = [];
  const numbers = (s: string) =>
    s.match(/\d+(?:[.,:]\d+)*(?:%|％|万|亿|元|岁|年|月|日|点|时)?/gu) ?? [];
  const quotes = (s: string) =>
    s.match(/[“「『][^”」』]*[”」』]|"[^"\n]*"/gu) ?? [];
  const negations = (s: string) =>
    s.match(/没有|并非|不是|不能|不得|不会|不要|从未|不|未|无/gu) ?? [];
  if (JSON.stringify(numbers(before)) !== JSON.stringify(numbers(after)))
    warnings.push("数字/日期/数量可能改变，请核对事实");
  if (JSON.stringify(quotes(before)) !== JSON.stringify(quotes(after)))
    warnings.push("引语可能改变，请核对是否必须原样保留");
  if (JSON.stringify(negations(before)) !== JSON.stringify(negations(after)))
    warnings.push("否定关系可能改变，请核对立场与逻辑");
  if (/而是|但是|因为|所以|如果|只有|除非/.test(before) && before !== after)
    warnings.push("逻辑连接关系发生修订，需要人工复核");
  if (before !== after)
    warnings.push("实体、人物语气与关键观点需人工复核；自动检查不保证语义等价");
  return warnings;
}
