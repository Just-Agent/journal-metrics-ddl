# Journal Metrics DDL

期刊分区、JCR/影响因子、发文量和指标历史轨迹专题族。

## 首批专题

- `cas-partition-ddl`：中科院期刊分区表历史节点、停更声明、授权数据边界。
- `jcr-impact-factor-ddl`：JCR 年度发布时间、后续修正/数据 reload 节点、影响因子授权导入边界。
- `journal-volume-ddl`：用开放元数据统计代表期刊发文量、年度发文趋势和最新完整年同比变化。

## 为什么要分轨

期刊评价不是单纯倒计时。用户真正关心：

- JCR 今年什么时候发布，是否有后续修正。
- 某本期刊影响因子和 quartile 这些年怎么变化。
- 中科院分区历史如何变化，2026 停更后怎么处理往年数据。
- 期刊当前发文量是否扩张/收缩，统计口径来自哪里。

因此本仓库严格区分：

- `officialDeadline`：官方发布会、官方版本或可确认未来节点。
- `historyEvent`：JCR 发布、CAS 停更声明、历史版本节点。
- `metricSnapshot`：指标快照，例如 JCR 收录总量、OpenAlex works_count、期刊年发文量。
- `forecastWindow`：仅作为趋势提示，不能当成官方日期。

## 数据边界

- CAS 分区详细表、JCR 影响因子明细通常涉及登录或授权，不在公开仓库中绕过权限抓取。
- 开放版先展示官方发布时间、公开说明、授权导入占位和 OpenAlex/Crossref 等开放元数据。
- 发文量必须显示统计口径；OpenAlex 发文量不等于 Web of Science/JCR 精确统计。
- 首批发文量 watchlist 覆盖综合、医学、计算机和生物信息学代表期刊，后续可以继续按学科扩展。

## Commands

```powershell
npm run crawl
npm run validate
npm run link-check
```
