const dotenv = require('dotenv');
dotenv.config();
const { program } = require('commander');
const { EsaUsecase } = require('./usecases/esa-usecase');

program
  .version('1.0.0')
  .option(('-t, --team <team>'), '同期先のesa.ioのチーム名')
  .option('-w, --wip', 'WIP状態で投稿')
  .option(('-n, --dry-run'), 'Dry Runモードによる実行')
  .option(('-i, --ignore-existing'), 'すでに同じタイトルの記事がある場合はスキップ')
  .argument('<source>', 'source')
  .argument('<destination>', 'esa.ioの同期先')
  .description('sync files from source to destination')
  .action(async (source, destination, options) => {
    await (new EsaUsecase).sync({ source, destination, options });
  });
program.parse();
