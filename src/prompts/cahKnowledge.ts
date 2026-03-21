/**
 * CAH built-in knowledge — compiled into the binary so chat always knows its capabilities.
 * @entry
 */

/** Core task commands — injected when user message contains CAH-related keywords */
export const CAH_KNOWLEDGE = `[CAH 能力]

# 创建任务
cah "任务描述"                        # 后台执行
cah "任务描述" -F                     # 前台执行（实时日志）
cah "任务描述" -a <agent> -b <backend> -m <model>  # 指定 agent/后端/模型
cah "任务描述" -S "30 9 * * *"        # 定时任务（cron）

# 任务管理
cah list [-s running/failed] [-w]     # 任务列表
cah logs <id> -f                      # 实时日志
cah task stop/resume/msg/complete <id>  # 停止/恢复/发消息/完成

更多命令: cah help`

/** Dev constraints — injected only when running inside the CAH project (self-development) */
export const CAH_DEV_CONSTRAINTS = `[CAH 开发约束]
- build 完成后告知用户发 /reload 重载（绝不自行 cah restart / kill 进程）
- 同目录任务自动排队，不同目录可并行
- 任务描述要具体明确，AI agent 自主执行无法反复确认`
