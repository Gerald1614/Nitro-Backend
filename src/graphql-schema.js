// import { neo4jgraphql } from "neo4j-graphql-js"
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import uuidv4 from 'uuid/v4'
import generateJwt from './jwt/generateToken'
import { fixUrl } from './middleware/fixImageUrlsMiddleware'
import { AuthenticationError } from 'apollo-server'

export const typeDefs =
  fs.readFileSync(process.env.GRAPHQL_SCHEMA || path.join(__dirname, 'schema.graphql'))
    .toString('utf-8')

export const query = (cypher, session) => {
  return new Promise((resolve, reject) => {
    let data = []
    session
      .run(cypher)
      .subscribe({
        onNext: function (record) {
          let item = {}
          record.keys.forEach(key => {
            item[key] = record.get(key)
          })
          data.push(item)
        },
        onCompleted: function () {
          session.close()
          resolve(data)
        },
        onError: function (error) {
          reject(error)
        }
      })
  })
}
const queryOne = (cypher, session) => {
  return new Promise((resolve, reject) => {
    query(cypher, session)
      .then(res => {
        resolve(res.length ? res.pop() : {})
      })
      .catch(err => {
        reject(err)
      })
  })
}

export const resolvers = {
  Query: {
    isLoggedIn: (parent, args, { driver, user }) => {
      return Boolean(user && user.id)
    },
    statistics: async (parent, args, { driver, user }) => {
      return new Promise(async (resolve) => {
        const session = driver.session()
        const queries = {
          countUsers: 'MATCH (r:User) WHERE r.deleted <> true OR NOT exists(r.deleted) RETURN COUNT(r) AS countUsers',
          countPosts: 'MATCH (r:Post) WHERE r.deleted <> true OR NOT exists(r.deleted) RETURN COUNT(r) AS countPosts',
          countComments: 'MATCH (r:Comment) WHERE r.deleted <> true OR NOT exists(r.deleted) RETURN COUNT(r) AS countComments',
          countNotifications: 'MATCH (r:Notification) WHERE r.deleted <> true OR NOT exists(r.deleted) RETURN COUNT(r) AS countNotifications',
          countOrganizations: 'MATCH (r:Organization) WHERE r.deleted <> true OR NOT exists(r.deleted) RETURN COUNT(r) AS countOrganizations',
          countProjects: 'MATCH (r:Project) WHERE r.deleted <> true OR NOT exists(r.deleted) RETURN COUNT(r) AS countProjects',
          countInvites: 'MATCH (r:Invite) WHERE r.wasUsed <> true OR NOT exists(r.wasUsed) RETURN COUNT(r) AS countInvites',
          countFollows: 'MATCH (:User)-[r:FOLLOWS]->(:User) RETURN COUNT(r) AS countFollows',
          countShouts: 'MATCH (:User)-[r:SHOUTED]->(:Post) RETURN COUNT(r) AS countShouts'
        }
        let data = {
          countUsers: (await queryOne(queries.countUsers, session)).countUsers,
          countPosts: (await queryOne(queries.countPosts, session)).countPosts,
          countComments: (await queryOne(queries.countComments, session)).countComments,
          countNotifications: (await queryOne(queries.countNotifications, session)).countNotifications,
          countOrganizations: (await queryOne(queries.countOrganizations, session)).countOrganizations,
          countProjects: (await queryOne(queries.countProjects, session)).countProjects,
          countInvites: (await queryOne(queries.countInvites, session)).countInvites,
          countFollows: (await queryOne(queries.countFollows, session)).countFollows,
          countShouts: (await queryOne(queries.countShouts, session)).countShouts
        }
        resolve(data)
      })
    }
    // usersBySubstring: neo4jgraphql
  },
  Mutation: {
    CreateUser: async (parent, args, { driver }) => {
      const session = driver.session()
      const userExists = await session.run(
        'MATCH (user:User {email: $userEmail}) ' +
        'RETURN user {.id, .name, .email} as user LIMIT 1', { userEmail: args.email })
      if (userExists.records.length === 0) {
        const user = {
          id: uuidv4(),
          name: args.name,
          email: args.email,
          slug: args.slug,
          password: args.password,
          role: 'user',
          avatar: 'https://www.w3schools.com/howto/img_avatar.png',
          deleted: false,
          disabled: false,
          verified: false,
          createdAt: args.createdAt
        }
        return session.run(
          'CREATE (user:User $user) ' +
          'RETURN user',
          { 'user': user })
          .then((result) => {
            session.close()
            const LoggedUser = result.records[0]._fields[0].properties
            delete LoggedUser.password
            LoggedUser.avatar = fixUrl(LoggedUser.avatar)
            return Object.assign(LoggedUser, {
              token: generateJwt(LoggedUser)
            })
          })
      }
      session.close()
      throw new Error('User already exists')
    },
    Login: async (parent, { email, password }, { driver, req, user }) => {
      const session = driver.session()
      return session.run(
        'MATCH (user:User {email: $userEmail}) ' +
        'RETURN user {.id, .slug, .name, .avatar, .locationName, .about, .email, .verified, .password, .role} as user LIMIT 1', { userEmail: email })
        .then(async (result) => {
          session.close()
          const [currentUser] = await result.records.map(function (record) {
            return record.get('user')
          })
          if (currentUser && await bcrypt.compareSync(password, currentUser.password)) {
            delete currentUser.password
            currentUser.avatar = fixUrl(currentUser.avatar)
            return Object.assign(currentUser, {
              token: generateJwt(currentUser)
            })
          } else throw new AuthenticationError('Incorrect email address or password.')
        })
    }
  }
}
