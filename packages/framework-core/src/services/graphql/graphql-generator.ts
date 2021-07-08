import {
  AnyClass,
  Logger,
  BoosterConfig,
  CommandEnvelope,
  ReadModelPropertyFilter,
  ReadModelRequestEnvelope,
  EventSearchRequest,
  EventFilter,
  EventSearchResponse,
  ReadModelRequestArgs,
} from '@boostercloud/framework-types'
import { GraphQLFieldResolver, GraphQLResolveInfo, GraphQLSchema } from 'graphql'
import { pluralize } from 'inflected'
import { GraphQLTypeInformer } from './graphql-type-informer'
import { GraphQLQueryGenerator } from './graphql-query-generator'
import { GraphQLMutationGenerator } from './graphql-mutation-generator'
import { GraphQLSubscriptionGenerator } from './graphql-subcriptions-generator'
import { BoosterCommandDispatcher } from '../../booster-command-dispatcher'
import { BoosterReadModelsReader } from '../../booster-read-models-reader'
import { BoosterEventsReader } from '../../booster-events-reader'
import { GraphQLResolverContext } from './common'

export class GraphQLGenerator {
  private readonly queryGenerator: GraphQLQueryGenerator
  private readonly mutationGenerator: GraphQLMutationGenerator
  private readonly subscriptionGenerator: GraphQLSubscriptionGenerator
  private readonly typeInformer: GraphQLTypeInformer

  private static singleton: GraphQLGenerator | undefined

  public static build(config: BoosterConfig, logger: Logger): GraphQLGenerator {
    this.singleton =
      this.singleton ??
      new GraphQLGenerator(
        config,
        new BoosterCommandDispatcher(config, logger),
        new BoosterReadModelsReader(config, logger),
        new BoosterEventsReader(config, logger)
      )
    return this.singleton
  }

  private constructor(
    config: BoosterConfig,
    private commandsDispatcher: BoosterCommandDispatcher,
    private readModelsReader: BoosterReadModelsReader,
    private eventsReader: BoosterEventsReader
  ) {
    this.typeInformer = new GraphQLTypeInformer({ ...config.readModels, ...config.commandHandlers })
    this.queryGenerator = new GraphQLQueryGenerator(
      config,
      config.readModels,
      this.typeInformer,
      this.readModelByIDResolverBuilder.bind(this),
      this.readModelResolverBuilder.bind(this),
      this.eventResolver.bind(this)
    )
    this.mutationGenerator = new GraphQLMutationGenerator(
      config.commandHandlers,
      this.typeInformer,
      this.commandResolverBuilder.bind(this)
    )
    this.subscriptionGenerator = new GraphQLSubscriptionGenerator(
      config.readModels,
      this.typeInformer,
      this.queryGenerator,
      this.subscriptionByIDResolverBuilder.bind(this, config),
      this.subscriptionResolverBuilder.bind(this, config)
    )
  }

  public generateSchema(): GraphQLSchema {
    return new GraphQLSchema({
      query: this.queryGenerator.generate(),
      mutation: this.mutationGenerator.generate(),
      subscription: this.subscriptionGenerator.generate(),
    })
  }

  public readModelResolverBuilder(
    readModelClass: AnyClass
  ): GraphQLFieldResolver<any, GraphQLResolverContext, ReadModelRequestArgs> {
    return (parent, args, context, info) => {
      let isPaginated = false
      if (info?.fieldName === `List${pluralize(readModelClass.name)}`) {
        isPaginated = true
      }
      const readModelEnvelope = toReadModelRequestEnvelope(readModelClass.name, args, context, isPaginated)
      return this.readModelsReader.fetch(readModelEnvelope)
    }
  }

  public readModelByIDResolverBuilder(
    readModelClass: AnyClass
  ): GraphQLFieldResolver<unknown, GraphQLResolverContext, { id: string }> {
    return async (parent, args, context, info) => {
      const filterArgs = { filter: { id: { eq: args.id } } }
      const result = await this.readModelResolverBuilder(readModelClass)(parent, filterArgs, context, info)
      return result[0]
    }
  }

  public eventResolver(
    parent: unknown,
    args: EventFilter,
    context: GraphQLResolverContext,
    info: GraphQLResolveInfo
  ): Promise<Array<EventSearchResponse>> {
    const eventsRequestEnvelope = toEventSearchRequest(args, context)
    return this.eventsReader.fetch(eventsRequestEnvelope)
  }

  public commandResolverBuilder(
    commandClass: AnyClass
  ): GraphQLFieldResolver<any, GraphQLResolverContext, { input: any }> {
    return async (parent, args, context, info) => {
      const commandEnvelope = toCommandEnvelope(commandClass.name, args.input, context)
      await this.commandsDispatcher.dispatchCommand(commandEnvelope)
      return true
    }
  }

  public subscriptionByIDResolverBuilder(
    config: BoosterConfig,
    readModelClass: AnyClass
  ): GraphQLFieldResolver<any, GraphQLResolverContext, Record<string, ReadModelPropertyFilter>> {
    return async (parent, args, context, info) => {
      const filterArgs = { filter: { id: { eq: args.id } } }
      return this.subscriptionResolverBuilder(config, readModelClass)(parent, filterArgs, context, info)
    }
  }

  public subscriptionResolverBuilder(
    config: BoosterConfig,
    readModelClass: AnyClass
  ): GraphQLFieldResolver<any, GraphQLResolverContext, ReadModelRequestArgs> {
    return async (parent, args, context, info) => {
      if (!context.connectionID) {
        throw new Error('Missing "connectionID". It is required for subscriptions')
      }

      const readModelRequestEnvelope = toReadModelRequestEnvelope(readModelClass.name, args, context)
      if (context.storeSubscriptions) {
        await this.readModelsReader.subscribe(context.connectionID, readModelRequestEnvelope, context.operation)
      }

      return context.pubSub.asyncIterator(readModelRequestEnvelope, config)
    }
  }
}

function toReadModelRequestEnvelope(
  readModelName: string,
  args: ReadModelRequestArgs,
  context: GraphQLResolverContext,
  paginatedVersion = false
): ReadModelRequestEnvelope {
  return {
    requestID: context.requestID,
    currentUser: context.user,
    typeName: readModelName,
    filters: args.filter ?? {},
    limit: args.limit,
    afterCursor: args.afterCursor,
    paginatedVersion,
    version: 1, // TODO: How to pass the version through GraphQL?
  }
}

function toEventSearchRequest(args: EventFilter, context: GraphQLResolverContext): EventSearchRequest {
  return {
    requestID: context.requestID,
    currentUser: context.user,
    filters: args,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCommandEnvelope(commandName: string, value: any, context: GraphQLResolverContext): CommandEnvelope {
  return {
    requestID: context.requestID,
    currentUser: context.user,
    typeName: commandName,
    value,
    version: 1, // TODO: How to pass the version through GraphQL?
  }
}
