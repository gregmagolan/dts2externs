# dts2externs
Parse typescript d.ts files and output google closure compiler externs file

# Installation

## Local

```
$ npm install dts2externs --save-dev
```

```
$ node node_modules/dts2externs/dist/bin.js -h
```

## Global
```
$ npm install -g dts2externs
$ dts2externs -h
```

# Usage

## In `npm` build scripts
For projects using `typings` plugin. Add new script in your `package.json`:
```json
{
  "scripts": {
    "externs": "dts2externs typings/index.d.ts -o externs.js",
  }
}
```

## In `gulp` build scripts
For projects using `typings` plugin. Include `dts2externs` `gulp` plugin:
```javascript
var dts2externs = require('dts2externs').gulp();
```

Create a new `gulp` task:
```javascript
gulp.task('externs', function() {
    return gulp.src(['typings/index.d.ts'])
        .pipe(dts2externs({keepComments:true, listParsedFiles:true}))
        .pipe(gulp.dest('dist'));
});
```
_Note: added two options (_ `keepComments` _and_ `listParsedFiles` _) as an example_

# License
This project is licensed under the MIT license
