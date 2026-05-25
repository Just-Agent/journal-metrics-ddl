# Journal Metrics DDL

期刊分区、JCR/影响因子、发文量和指标历史轨迹专题族。

## 首批专题

- `cas-partition-ddl`：中科院期刊分区表发布沿革、停更声明、历史查询与授权导入边界。
- `jcr-impact-factor-ddl`：JCR 年度发布时间、10 月后续修正/数据 reload 节点、影响因子授权导入边界。
- `journal-volume-ddl`：用开放元数据统计代表期刊发文量、年度发文趋势和最新完整年同比变化。

## 为什么要分轨

期刊评价不是单纯倒计时。用户真正关心：

- JCR 今年什么时候发布，过去几年是否稳定在 6 月下旬，10 月是否有后续修正。
- 某本期刊影响因子和 quartile 这些年怎么变化。
- 中科院分区历史如何变化，2026 停更后怎么处理往年数据，以及如何合规导入单刊分区轨迹。
- 期刊当前发文量是否扩张/收缩，统计口径来自哪里。

因此本仓库严格区分：

- `officialDeadline`：官方发布会、官方版本或可确认未来节点。
- `historyEvent`：JCR 发布、CAS 停更声明、历史版本节点。
- `metricSnapshot`：指标快照，例如 JCR 收录总量、OpenAlex works_count、期刊年发文量。
- `forecastWindow`：仅作为趋势提示，不能当成官方日期。

## 数据边界

- CAS 分区详细表、JCR 影响因子明细通常涉及登录或授权，不在公开仓库中绕过权限抓取。
- 开放版先展示官方发布时间、公开说明、授权导入占位和 OpenAlex/Crossref 等开放元数据。
- `data/` 保留爬虫、授权导入和校验所需的维护字段；Pages、Hub 和小程序只读取 `public-data/`，避免把授权说明、解析器、非公开维护信息或调试字段发布到网页。
- 发文量必须显示统计口径；OpenAlex 发文量不等于 Web of Science/JCR 精确统计。
- 当前日历年发文量必须标成 YTD 快照，只能用于“截至当前抓取日”的观察；扩张/收缩趋势只比较已完整结束的年份。
- 首批发文量 watchlist 已扩展到 42 本综合、医学、AI、计算机、图形学、NLP、医学影像、数据管理、软件工程和机器人代表期刊，后续可以继续按学科扩展。
- JCR 轨迹首版覆盖 2021-2025 年 6 月年度发布记录与 2021-2025 年 10 月 Data Reload / correction 记录；2026 发布窗口和修正观察窗口均以这些官方历史节点为依据。

## CAS 授权导入

公开仓库不会抓取需要登录或机构授权的单刊分区明细。如果你有合规授权文件，可以按模板导入：

```powershell
Copy-Item data/imports/cas-partition-history.template.csv data/imports/cas-partition-history.csv
$env:CAS_HISTORY_CSV='data/imports/cas-partition-history.csv'
npm run import:cas-history
npm run validate
```

导入后会生成 `cas_major_zone` 指标快照，用于展示某本期刊历年一区/二区/三区/四区变化；导入文件不应提交含敏感授权信息的原始材料。

CSV 中如果学科名、类别名或来源名包含英文逗号，请用英文双引号包住整列，例如 `"Computer Science, Artificial Intelligence"`。

默认导入是增量更新：同一本期刊、同一年、同一大类的记录会被新 CSV 覆盖，其他已导入期刊会保留。若确实要重建全部 CAS 单刊轨迹，再设置：

```powershell
$env:CAS_IMPORT_REPLACE_ALL='1'
npm run import:cas-history
```

## JCR 授权导入

单刊影响因子、JIF Quartile 和类别排名通常属于 JCR 授权数据。仓库提供导入通道，但不提交原始授权文件：

```powershell
Copy-Item data/imports/jcr-impact-history.template.csv data/imports/jcr-impact-history.csv
$env:JCR_HISTORY_CSV='data/imports/jcr-impact-history.csv'
npm run import:jcr-history
npm run validate
```

导入后会生成两类 `metricSnapshot`：`journal_impact_factor` 和 `jcr_quartile`。公开页面只展示期刊名、年份、JIF、Quartile、类别和来源链接；授权文件本身不进入 Hub 或小程序公开出口。

CSV 中如果 JCR 类别包含英文逗号，请用英文双引号包住整列，例如 `"Computer Science, Artificial Intelligence"`，否则普通 CSV 解析会把它拆成两列。

默认导入是增量更新：同一本期刊、同一年、同一类别的 Quartile 记录会被新 CSV 覆盖，其他已导入期刊会保留；同一本期刊同一年只保留一个 Journal Impact Factor，避免多类别期刊重复生成 JIF。若要重建全部 JCR 单刊轨迹，再设置：

```powershell
$env:JCR_IMPORT_REPLACE_ALL='1'
npm run import:jcr-history
```

导入真实授权 CSV 前建议先跑一次冒烟测试，确认本地环境不会破坏增量导入、多类别期刊和带逗号的 JCR/CAS 分类字段：

```powershell
npm run test:imports
```

## Commands

```powershell
npm run crawl
npm run test:imports
npm run validate
npm run export:public
npm run validate:public
npm run build
npm run link-check
```
