# 人物互动与动作结果

### 人物互动、手别与动作结果

互动需要可见的角色职责和身体路径。描述发起者、使用部位、目标、接触方式以及此刻的状态；空闲手、支撑面和持物数量在有歧义时补明。两个角色都写holding不一定能分清谁抓谁、谁托谁。

有效动作tag可在人物正向中配source#／target#；对等参与可用mutual#。这些前缀表达动作角色，不是可以编号配对的身份ID；也不能代替具体接触句。

下面是握腕示例，服装和人物类型应替换成当前设定：

```text
[Character 1]
girl, white shirt, long sleeves, source#holding another's wrist,
She is an adult woman. Her right hand closes around his left wrist. Show the gripping fingers and both relevant forearms. Her other hand stays separate and empty.

[Character 2]
boy, black shirt, short sleeves, target#holding another's wrist,
He is an adult man. His left wrist is held by her right hand. His right hand remains free below the grip.
```

人物自身的左／右、画面左／右和身体朝向是不同概念。严格正面并肩时，画左者的右臂与画右者的左臂都位于外侧；若要求这对手在中间接触，需要跨身路径，而非直接把画面近侧手叫成指定手。可以补：

```text
Her right forearm crosses in front of her white shirt from the far image-left upper arm toward the central grip. His left forearm crosses in front of his black shirt from the far image-right upper arm toward that same grip.
```

这能表达路径，但不能保证正确抓握或主被动。若用户允许换机位，背向或侧向可让目标臂更自然接近；不能擅改已经指定的正面画面。核对身体关系时沿肩、肘、袖口到手追踪，不能只看手掌在画面哪边。

需要双手的姿势直接写Both hands rest visibly on her knees. 递物完成写The receiver alone holds the sheet while the giver's hands have fully released it. 到达写脚实际落在目标地面，接住写谁承担重量及原支撑是否解除。台词里的“接住了”“到了”不是画面结果的替代。

跨格连续还要保留物件的数量、形状、当前持有人和支撑面。手部特写、插格或更大的主格可以给证据更多面积；动作被放大不代表结构自动正确。镜头改变时重新检查这些关系，而不是只复制上一格的左右。
