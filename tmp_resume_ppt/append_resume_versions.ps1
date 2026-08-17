param([string]$pptPath)

$financeIntern1 = @"
 1）策略工程：设计 MC-Return PPO 训练框架，对连续状态离散分桶并进行 Embedding 编码，完成 LunarLander-v2 / Pong-ram-v0 等环境复现与调参，沉淀可复用策略训练流程。 2）业务建模：面向国际化出行 hold 决策场景，协助构建订单时间片序列决策 MDP，设计订单、司机分布与 ETA-action 等状态/动作特征，并结合业务规则构建奖励函数。 3）效果验证：引入模仿学习缓解初始策略不稳定问题，测试集预测精度与召回率均超过 90%；在巴西两城 A/B 实验中使订单成交率提升 0.2pp。 4）离线评估：调研 OPE 方法并采用重要性采样进行离线评估，IS 得分与实际成交率曲线保持一致，为策略上线提供参考。
"@

$financeIntern2 = @"
1）内容理解：基于 SigLIP2 搭建视频—音乐匹配模型，负责特征建模、样本构建、损失函数设计与训练策略优化，提升模型对语义、风格、情绪及使用场景的理解能力。2）生成式推荐：基于 RQ-VAE 开展音乐离散表征学习与生成式召回，负责向量量化、codebook 训练、模型调优与实验分析，并基于 Qwen-3.5 进行 LoRA 微调。3）工程部署：面向多国家本地化推荐构建区域化召回库，结合离线评估与 A/B 实验优化重排策略；基于 Triton 将 PyTorch 模型封装为 H20/L20/A10 TensorRT Plan，完成服务部署、线上发布、状态监控与异常排查。
"@

$financeProjectTitle = "澄川银行智能运维台"
$financeProjectRole = "   AI应用工程 / 全栈开发"
$financeProject = @"
1）系统设计：面向银行基础设施运维场景，独立设计并实现智能运维工作台，覆盖机房资产、主机状态、维保厂商、异常机器与日常巡检任务管理。2）Agent 集成：基于 Letta SDK 接入 LiteLLM 网关与 MiniMax 模型，支持资产数据自然语言问答、异常汇总、巡检报告生成与运维知识沉淀。3）工程实现：采用 HTML/CSS/JavaScript、TypeScript/Node.js 与 PostgreSQL 实现登录鉴权、资产筛选检索、状态统计、多轮会话、文件上传和定时任务配置。4）部署交付：基于 Docker 与 Nginx 完成云端部署，形成“资产查看—异常追问—定时巡检—结果沉淀”的完整演示工作流。
"@

$financeSkills = @"
1. 求职定位：北京金融总部/央国企科技部门 AI 应用工程、智能系统开发、金融科技方向。2. 技术能力：熟悉 Python、TypeScript/Node.js、C++、SQL，具备 Web 系统开发、PostgreSQL 数据建模、Docker/Nginx 部署、Triton 推理服务部署与监控经验。3. AI 能力：熟悉大模型应用、Letta Agent、LiteLLM、LoRA 微调、推荐系统、强化学习与多模态内容理解，能将模型能力接入业务系统。4. 成果与综合素质：第一作者 EI 论文 accepted，发明专利四项；研究生特等学业奖学金、本科生一等学业奖学金；中共预备党员，曾任硕士导航班团支书、宣传部部长、学院学生办公室助管。
"@

$algoIntern1 = @"
 1）算法框架：设计 MC-Return PPO 训练框架，通过连续状态分桶离散化与 Embedding 编码提升策略网络表达能力，在 LunarLander-v2 / Pong-ram-v0 等环境完成稳定复现与系统性调参。 2）模仿学习：为降低初始策略对线上调度稳定性的影响，基于专家数据开展模仿学习，比较累计式/分段式 ETA 特征并调试 class-weights，测试集预测精度与召回率均超过 90%。 3）强化学习：针对 hold 阶段人工阈值难以兼顾体验与成本的问题，协助构建订单时间片序列决策 MDP，设计状态特征、5 类 ETA-action 与奖励函数，在巴西两城 A/B 实验中使订单成交率提升 0.2pp。 4）离线评估：调研 OPE 方法并采用重要性采样进行评估，IS 得分与实际成交率曲线保持高度一致。
"@

$algoIntern2 = @"
1）多模态理解：基于 SigLIP2 搭建视频—音乐内容理解与匹配模型，负责特征建模、样本构建、损失函数设计与分布式训练策略优化。2）生成式推荐：基于 RQ-VAE 开展音乐离散表征学习与生成式推荐建模，负责向量量化、codebook 训练、模型结构调优及实验分析；针对码本利用率坍缩问题调整 tokenization 编解码结构，并基于 Qwen-3.5 进行 LoRA 微调用于生成式召回。3）召回与部署：面向多国家本地化推荐构建区域化音乐召回库，结合离线评估与 A/B 实验优化重排策略；基于 Triton 将 PyTorch 模型封装为 H20/L20/A10 TensorRT Plan 并完成上线监控。
"@

$algoProjectTitle = "某空战智能模型研究（973项目子课题）"
$algoProjectRole = "   强化学习算法研发"
$algoProject = @"
1）环境构建：构建三维导弹–无人机追逃环境，设计 10 维状态（机/弹位置与姿态）和 5 类离散机动动作，并通过 reward shaping 缓解奖励稀疏问题。2）算法设计：针对部分可观环境对历史信息的依赖，构建结合 Gated-TransformerXL 的 PPO 框架，以当前状态为查询、情景记忆为键值进行多头注意力计算，得到融合长程依赖的时序表示。3）实验效果：与基线 PPO 对比，平均回报从 -560 提升至 407，胜率由 63.3% 提升至 85.7%。项目申请发明专利，专利号：2024114159214（导师第一，学生第二，已公开）并发表论文。
"@

$algoSkills = @"
1. 求职定位：算法研发、推荐算法、强化学习、大模型应用与模型部署方向。2. 论文成果：An improved PPO-GTrXL algorithm for missile evasion in partially observable air combat，中国自动化大会 2025.10（Accepted，第一作者，EI）；发明专利四项。3. 技术能力：熟练掌握 Python、C++、SQL，熟悉强化学习、深度学习、推荐系统、多模态表征、大模型微调与 LangChain/Agent 应用架构。4. 工程能力：熟悉 HDFS、Spark、Triton、TensorRT、Docker/Nginx 与模型上线监控，具备数据处理、离线计算、模型部署与异常排查经验；中共预备党员，研究生特等学业奖学金。
"@

function Set-ShapeText($slide, $shapeName, $text) {
  foreach ($shape in $slide.Shapes) {
    if ($shape.Name -eq $shapeName) {
      if ($shape.HasTextFrame -eq -1) {
        $shape.TextFrame.TextRange.Text = $text
      }
      return
    }
  }
}

function Set-GroupShapeText($slide, $groupName, $innerName, $text) {
  foreach ($shape in $slide.Shapes) {
    if ($shape.Name -eq $groupName -and $shape.Type -eq 6) {
      foreach ($inner in $shape.GroupItems) {
        if ($inner.Name -eq $innerName -and $inner.HasTextFrame -eq -1) {
          $inner.TextFrame.TextRange.Text = $text
          return
        }
      }
    }
  }
}

function Set-TableCell($slide, $tableName, $row, $col, $text) {
  foreach ($shape in $slide.Shapes) {
    if ($shape.Name -eq $tableName -and $shape.Type -eq 19) {
      $shape.Table.Cell($row, $col).Shape.TextFrame.TextRange.Text = $text
      return
    }
  }
}

function Add-VersionSlide($pres, $sourceIndex, $versionLabel) {
  $range = $pres.Slides.Item($sourceIndex).Duplicate()
  $slide = $range.Item(1)
  $slide.MoveTo($pres.Slides.Count)
  $label = $slide.Shapes.AddTextbox(1, 474, 204, 84, 18)
  $label.TextFrame.TextRange.Text = $versionLabel
  $label.TextFrame.TextRange.Font.Size = 8
  $label.TextFrame.TextRange.Font.Bold = -1
  $label.TextFrame.TextRange.Font.Color.RGB = 0x006B2E
  return $slide
}

function Apply-FinanceVersion($slide) {
  Set-TableCell $slide 'Table 16' 1 1 '2024.10-2025.02'
  Set-TableCell $slide 'Table 16' 1 2 '滴滴出行（国际化出行）'
  Set-TableCell $slide 'Table 16' 1 3 '   策略算法实习生'
  Set-ShapeText $slide 'TextBox 5' $financeIntern1

  Set-TableCell $slide 'Table 14' 1 1 '2025.12-2026.05'
  Set-TableCell $slide 'Table 14' 1 2 '字节跳动（TikTok 短视频推荐团队）'
  Set-TableCell $slide 'Table 14' 1 3 '   推荐算法实习生'
  Set-TableCell $slide 'Table 14' 2 1 $financeIntern2
  Set-TableCell $slide 'Table 14' 2 2 $financeIntern2
  Set-TableCell $slide 'Table 14' 2 3 $financeIntern2

  Set-TableCell $slide 'Table 1' 1 1 '2026.07-2026.08'
  Set-TableCell $slide 'Table 1' 1 2 $financeProjectTitle
  Set-TableCell $slide 'Table 1' 1 3 $financeProjectRole
  Set-ShapeText $slide 'TextBox 8' $financeProject
  Set-GroupShapeText $slide 'Group 57' 'Rectangle 61' '定位与技能'
  Set-ShapeText $slide 'TextBox 32' $financeSkills
}

function Apply-AlgoVersion($slide) {
  Set-ShapeText $slide 'TextBox 5' $algoIntern1
  Set-TableCell $slide 'Table 14' 1 2 '字节跳动（TikTok 短视频推荐团队）'
  Set-TableCell $slide 'Table 14' 2 1 $algoIntern2
  Set-TableCell $slide 'Table 14' 2 2 $algoIntern2
  Set-TableCell $slide 'Table 14' 2 3 $algoIntern2
  Set-TableCell $slide 'Table 1' 1 2 $algoProjectTitle
  Set-TableCell $slide 'Table 1' 1 3 $algoProjectRole
  Set-ShapeText $slide 'TextBox 8' $algoProject
  Set-ShapeText $slide 'TextBox 32' $algoSkills
}

$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open($pptPath, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoFalse)

$finance = Add-VersionSlide $pres 11 '金融总部科技版'
Apply-FinanceVersion $finance

$algo = Add-VersionSlide $pres 11 '算法研发备选版'
Apply-AlgoVersion $algo

$pres.Save()
$pres.Close()
$app.Quit()
