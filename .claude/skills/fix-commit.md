第一步：安装 git-filter-repo
brew install git-filter-repo

第二步：重写历史
git filter-repo --force --mailmap <(echo "Mt-Youya <dd257248@163.com> username <user email>")

第三步：强制推送
git remote add origin https://github.com/Mt-Youya/tubepilot.git  # filter-repo 会删掉 remote，需要重新加
git push --force --all
git push --force --tags
  
---
验证替换是否正确（推送前先确认）：
git log --format="%H %an <%ae>" | grep -i "username\|useremail"
如果没有输出说明全部替换干净了。
  
---

▎ ⚠️  filter-repo 执行后会自动删除 remote，第三步必须重新 add origin。