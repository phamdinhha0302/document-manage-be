const TokenGenerator = require('uuid-token-generator')

module.exports = () => {
    const tokenGen = new TokenGenerator(512, TokenGenerator.BASE62)
    return tokenGen.generate().slice(0, 60)
}
