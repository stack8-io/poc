## 開発の始め方

### 開発に必要なもの

- AWSアカウント
- 予算(1環境を起動させっぱなしにすると1ヶ月5万円程必要)
- AWS CLI, Node.js, Pulumiがインストールされている環境

### 環境構築の例

VSCode Dev Containersを使って環境を構築する手順を紹介します

- [Docker](https://www.docker.com/)をインストール
- [VSCode](https://code.visualstudio.com/)をインストール
- VSCodeに[Dev Containers拡張](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)をインストール
- `git clone https://github.com/stack8-io/vscode-workspace.git`でDev Containers用のリポジトリをCloneする
- VSCodeで`Command + Shift + P`でコマンドパレットを開き`Dev Containers: Open Folder In Container...`を選択しClone先のフォルダを選択する
- タイトルバーに`repos [Dev Container: stack8 @ xxx]`と表示されたVSCodeウィンドウが立ち上がる
- Dockerイメージのビルドに数分かかるので待機する
- `docker ps`コマンドで`stack8-dev`というコンテナが立ち上がっていることを確認
- `docker exec -it -w /repos stack8-dev-1 zsh`というコマンドで上記のコンテナに接続する
- `git clone https://github.com/stack8-io/poc.git`でリポジトリをコンテナ内にCloneする
- `git clone https://github.com/stack8-io/vscode-workspace.git`でDev Containers用のリポジトリもコンテナ内にCloneする
- タイトルバーに`repos [Dev Container: stack8 @ xxx]`と表示されたVSCodeで`Command + Shift + P`でコマンドパレットを開き`File Open Workspace form File...`を選び`/repos/vscode-workspace/.devcontainer/example.code-workspace`を選択する
- VSCodeのタイトルバーが`example (Workspace) [Dev Container: stack8 @ xxx]`になっていればOK

### ディレクトリ構成

- `npm workspaces`で管理されている 
- `lib`にライブラリ本体がある
- `example`以下に利用サンプルがある

### クイックスタート

- `npm install`で必要なnpmライブラリをインストール
- `npm run dev`で開発開始
- `aws configure`でAWSの認証情報などを設定
- `example`フォルダに移動して`pulumi up`でAWS上にリソースが作成される

