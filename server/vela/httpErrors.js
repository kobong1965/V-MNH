export const velaJsonErrorHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: '请求正文必须是有效的 JSON 对象。',
      code: 'INVALID_INPUT'
    });
  }
  return next(error);
};
